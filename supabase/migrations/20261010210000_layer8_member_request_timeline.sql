-- Layer 8 member-owned purchasing requests and append-only milestones.
-- Authenticated clients may read their own request timeline. All writes go
-- through the verified-member / active-worker API using service_role.

create table if not exists public.member_purchase_requests (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    product_id uuid references public.directory_products(id) on delete set null,
    product_name_snapshot text,
    request_title text not null check (length(btrim(request_title)) between 1 and 160),
    request_description text check (request_description is null or length(request_description) <= 2000),
    assigned_worker_id uuid references public.fayfort_workers(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_member_purchase_requests_member_created
    on public.member_purchase_requests(member_id, created_at desc);
create index if not exists idx_member_purchase_requests_worker_created
    on public.member_purchase_requests(assigned_worker_id, created_at desc)
    where assigned_worker_id is not null;

create table if not exists public.member_request_events (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.member_purchase_requests(id) on delete cascade,
    sequence_no bigint not null check (sequence_no > 0),
    stage text not null check (stage in (
        'submitted', 'under_review', 'sourcing', 'needs_member_input',
        'options_sent', 'purchase_confirmed', 'in_transit', 'delivered', 'cancelled'
    )),
    member_note text check (member_note is null or length(member_note) <= 1000),
    actor_user_id uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    unique (request_id, sequence_no)
);

create index if not exists idx_member_request_events_request_sequence
    on public.member_request_events(request_id, sequence_no);

alter table public.member_purchase_requests enable row level security;
alter table public.member_request_events enable row level security;
revoke all on public.member_purchase_requests from anon, authenticated;
revoke all on public.member_request_events from anon, authenticated;
grant select on public.member_purchase_requests to authenticated;
grant select on public.member_request_events to authenticated;
grant all on public.member_purchase_requests to service_role;
grant all on public.member_request_events to service_role;

drop policy if exists member_purchase_requests_read_own on public.member_purchase_requests;
create policy member_purchase_requests_read_own on public.member_purchase_requests
    for select to authenticated using (member_id = (select auth.uid()));

drop policy if exists member_request_events_read_own on public.member_request_events;
create policy member_request_events_read_own on public.member_request_events
    for select to authenticated using (
        exists (
            select 1 from public.member_purchase_requests request
            where request.id = request_id and request.member_id = (select auth.uid())
        )
    );

create or replace function public.prevent_member_request_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
        return old;
    end if;
    raise exception 'member request timeline events are append-only';
end;
$$;

drop trigger if exists member_request_events_append_only on public.member_request_events;
create trigger member_request_events_append_only
    before update or delete on public.member_request_events
    for each row execute function public.prevent_member_request_event_mutation();

create or replace function public.create_member_purchase_request(
    p_member_id uuid,
    p_request_title text,
    p_request_description text default null,
    p_product_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_request_id uuid;
    v_product_name text;
begin
    if p_product_id is not null then
        select product.name into v_product_name
        from public.directory_products product
        where product.id = p_product_id and product.active = true;
        if not found then
            raise exception 'product is not available';
        end if;
    end if;

    insert into public.member_purchase_requests (
        member_id, product_id, product_name_snapshot, request_title, request_description
    ) values (
        p_member_id, p_product_id, v_product_name, btrim(p_request_title), nullif(btrim(p_request_description), '')
    ) returning id into v_request_id;

    insert into public.member_request_events(request_id, sequence_no, stage, actor_user_id)
    values (v_request_id, 1, 'submitted', p_member_id);
    return v_request_id;
end;
$$;

create or replace function public.append_member_request_milestone(
    p_request_id uuid,
    p_worker_id uuid,
    p_stage text,
    p_member_note text default null
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
        when 'sourcing' then p_stage in ('needs_member_input', 'options_sent', 'cancelled')
        when 'needs_member_input' then p_stage in ('sourcing', 'options_sent', 'cancelled')
        when 'options_sent' then p_stage in ('purchase_confirmed', 'sourcing', 'cancelled')
        when 'purchase_confirmed' then p_stage = 'in_transit'
        when 'in_transit' then p_stage = 'delivered'
        else false
    end;
    if not v_allowed then raise exception 'invalid request stage transition'; end if;

    v_sequence := coalesce(v_sequence, 0) + 1;
    insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id)
    values (p_request_id, v_sequence, p_stage, nullif(btrim(p_member_note), ''), p_worker_id);
    update public.member_purchase_requests set updated_at = now() where id = p_request_id;
    return v_sequence;
end;
$$;

revoke all on function public.prevent_member_request_event_mutation() from public, anon, authenticated;
revoke all on function public.create_member_purchase_request(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.append_member_request_milestone(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_member_purchase_request(uuid, text, text, uuid) to service_role;
grant execute on function public.append_member_request_milestone(uuid, uuid, text, text) to service_role;

comment on table public.member_purchase_requests is
    'Consumer purchasing/sourcing requests, separate from Layer 5 channel customer_requests.';
comment on table public.member_request_events is
    'Append-only member-visible fulfillment milestones; current phase is the last sequence.';
