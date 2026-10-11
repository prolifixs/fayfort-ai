-- Layer 8 FR-015: warehouse evidence and carrier-neutral shipment milestones.
-- Private evidence is uploaded/read through the authenticated API using service_role.

alter table public.member_request_events
    add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.member_request_events
    drop constraint if exists member_request_events_stage_check,
    add constraint member_request_events_stage_check check (stage in (
        'submitted', 'under_review', 'sourcing', 'needs_member_input',
        'options_sent', 'purchase_confirmed', 'item_in_warehouse', 'shipped',
        'in_transit', 'out_for_delivery', 'delivered', 'cancelled'
    )),
    drop constraint if exists member_request_events_details_check,
    add constraint member_request_events_details_check check (
        jsonb_typeof(details) = 'object'
        and (
            (stage = 'shipped'
                and jsonb_typeof(details->'tracking_number') = 'string'
                and length(btrim(details->>'tracking_number')) between 1 and 120
                and (details->>'carrier_name' is null or length(details->>'carrier_name') <= 100)
                and (details->>'tracking_url' is null or details->>'tracking_url' ~ '^https://[^[:space:]]+$')
                and details - 'carrier_name' - 'tracking_number' - 'tracking_url' = '{}'::jsonb)
            or (stage <> 'shipped' and details = '{}'::jsonb)
        )
    );

create table if not exists public.member_request_media (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.member_purchase_requests(id) on delete cascade,
    event_id uuid not null references public.member_request_events(id) on delete cascade,
    storage_path text not null unique,
    content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
    byte_size bigint not null check (byte_size between 1 and 104857600),
    original_filename text not null check (length(original_filename) between 1 and 255),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists idx_member_request_media_request_event
    on public.member_request_media(request_id, event_id, created_at);

alter table public.member_request_media enable row level security;
revoke all on public.member_request_media from anon, authenticated;
grant all on public.member_request_media to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
    'member-request-evidence', 'member-request-evidence', false, 104857600,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop function if exists public.append_member_request_milestone(uuid, uuid, text, text);
create or replace function public.append_member_request_milestone(
    p_request_id uuid,
    p_worker_id uuid,
    p_stage text,
    p_member_note text default null,
    p_details jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_request public.member_purchase_requests%rowtype;
    v_previous_stage text;
    v_sequence bigint;
    v_allowed boolean := false;
begin
    select * into v_request from public.member_purchase_requests
    where id = p_request_id for update;
    if not found then raise exception 'request not found'; end if;

    if v_request.assigned_worker_id is distinct from p_worker_id or not exists (
        select 1 from public.fayfort_workers worker
        where worker.user_id = p_worker_id and worker.status = 'active'
    ) then
        raise exception 'worker is not assigned to this request';
    end if;

    select event.stage, event.sequence_no into v_previous_stage, v_sequence
    from public.member_request_events event
    where event.request_id = p_request_id
    order by event.sequence_no desc limit 1;

    v_allowed := case v_previous_stage
        when 'submitted' then p_stage in ('under_review', 'cancelled')
        when 'under_review' then p_stage in ('sourcing', 'needs_member_input', 'cancelled')
        when 'sourcing' then p_stage in ('needs_member_input', 'options_sent', 'purchase_confirmed', 'item_in_warehouse', 'cancelled')
        when 'needs_member_input' then p_stage in ('sourcing', 'options_sent', 'cancelled')
        when 'options_sent' then p_stage in ('purchase_confirmed', 'sourcing', 'cancelled')
        when 'purchase_confirmed' then p_stage in ('item_in_warehouse', 'cancelled')
        when 'item_in_warehouse' then p_stage in ('shipped', 'cancelled')
        when 'shipped' then p_stage in ('in_transit', 'out_for_delivery', 'delivered')
        when 'in_transit' then p_stage in ('out_for_delivery', 'delivered')
        when 'out_for_delivery' then p_stage = 'delivered'
        else false
    end;
    if not v_allowed then raise exception 'invalid request stage transition'; end if;

    if p_stage = 'shipped' then
        if jsonb_typeof(p_details) <> 'object'
            or jsonb_typeof(p_details->'tracking_number') <> 'string'
            or length(btrim(p_details->>'tracking_number')) not between 1 and 120
            or (p_details->>'tracking_url' is not null and p_details->>'tracking_url' !~ '^https://[^[:space:]]+$')
            or (p_details->>'carrier_name' is not null and length(p_details->>'carrier_name') > 100)
            or p_details - 'carrier_name' - 'tracking_number' - 'tracking_url' <> '{}'::jsonb then
            raise exception 'shipped milestone requires a tracking number and valid shipment details';
        end if;
    elsif p_details <> '{}'::jsonb then
        raise exception 'details are only accepted for shipped milestones';
    end if;

    v_sequence := coalesce(v_sequence, 0) + 1;
    insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id, details)
    values (p_request_id, v_sequence, p_stage, nullif(btrim(p_member_note), ''), p_worker_id, coalesce(p_details, '{}'::jsonb));
    update public.member_purchase_requests set updated_at = now() where id = p_request_id;
    return v_sequence;
end;
$$;

revoke all on function public.append_member_request_milestone(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_member_request_milestone(uuid, uuid, text, text, jsonb) to service_role;

comment on table public.member_request_media is
    'Private worker-uploaded warehouse evidence. Access and signed URLs are enforced by the authenticated FayFort API.';
