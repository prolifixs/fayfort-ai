-- Add separate, staff-only dispute cases without changing the canonical
-- member-request milestone history or its existing operations work item.

create table if not exists public.operations_dispute_cases (
    id uuid primary key default gen_random_uuid(),
    member_request_id uuid not null references public.member_purchase_requests(id) on delete cascade,
    category text not null check (category in (
        'wrong_item', 'item_condition', 'missing_item', 'delivery', 'payment', 'other'
    )),
    summary text not null check (length(btrim(summary)) between 1 and 2000),
    status text not null default 'open' check (status in (
        'open', 'investigating', 'awaiting_member', 'awaiting_supplier', 'resolved', 'closed'
    )),
    resolution text check (resolution is null or length(btrim(resolution)) <= 2000),
    version bigint not null default 1 check (version > 0),
    opened_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz,
    closed_at timestamptz,
    check ((status in ('resolved', 'closed')) = (resolution is not null)),
    check ((status = 'resolved') = (resolved_at is not null)),
    check ((status = 'closed') = (closed_at is not null))
);
create index if not exists idx_operations_dispute_cases_request
    on public.operations_dispute_cases(member_request_id, created_at desc);
create unique index if not exists idx_operations_dispute_one_active_per_request
    on public.operations_dispute_cases(member_request_id)
    where status not in ('resolved', 'closed');

alter table public.operations_work_items
    add column if not exists dispute_case_id uuid references public.operations_dispute_cases(id) on delete cascade;
alter table public.operations_work_items
    drop constraint if exists operations_work_items_single_source,
    add constraint operations_work_items_single_source check (
        num_nonnulls(member_request_id, member_conversation_id,
            business_conversation_id, handoff_id, dispute_case_id) = 1
    );
create unique index if not exists idx_operations_work_unique_dispute_case
    on public.operations_work_items(dispute_case_id) where dispute_case_id is not null;

create table if not exists public.operations_dispute_events (
    id uuid primary key default gen_random_uuid(),
    dispute_case_id uuid not null references public.operations_dispute_cases(id) on delete cascade,
    sequence_no bigint not null check (sequence_no > 0),
    actor_id uuid not null references auth.users(id) on delete restrict,
    previous_status text check (previous_status is null or previous_status in (
        'open', 'investigating', 'awaiting_member', 'awaiting_supplier', 'resolved', 'closed'
    )),
    next_status text not null check (next_status in (
        'open', 'investigating', 'awaiting_member', 'awaiting_supplier', 'resolved', 'closed'
    )),
    note text not null check (length(btrim(note)) between 1 and 2000),
    created_at timestamptz not null default now(),
    unique(dispute_case_id, sequence_no)
);
create index if not exists idx_operations_dispute_events_history
    on public.operations_dispute_events(dispute_case_id, sequence_no);

alter table public.operations_dispute_cases enable row level security;
alter table public.operations_dispute_events enable row level security;
revoke all on public.operations_dispute_cases, public.operations_dispute_events from public, anon, authenticated;
grant all on public.operations_dispute_cases, public.operations_dispute_events to service_role;
create or replace function public.prevent_operations_dispute_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    raise exception 'dispute events are append-only';
end;
$$;
revoke all on function public.prevent_operations_dispute_event_mutation() from public, anon, authenticated;
grant execute on function public.prevent_operations_dispute_event_mutation() to service_role;
drop trigger if exists operations_dispute_events_append_only on public.operations_dispute_events;
create trigger operations_dispute_events_append_only
    before update or delete on public.operations_dispute_events
    for each row execute function public.prevent_operations_dispute_event_mutation();

create or replace function public.create_operations_dispute_case(
    p_actor_id uuid,
    p_actor_type text,
    p_request_id uuid,
    p_category text,
    p_summary text,
    p_next_action text,
    p_due_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_case public.operations_dispute_cases%rowtype;
    v_item public.operations_work_items%rowtype;
begin
    if p_actor_type not in ('worker', 'platform_admin') then raise exception 'invalid dispute actor'; end if;
    if length(btrim(coalesce(p_summary, ''))) not between 1 and 2000
       or length(btrim(coalesce(p_next_action, ''))) not between 1 and 500 then
        raise exception 'dispute summary and next action are required';
    end if;
    if not exists (select 1 from public.member_purchase_requests where id = p_request_id) then
        raise exception 'member request not found';
    end if;
    insert into public.operations_dispute_cases(member_request_id, category, summary, opened_by)
    values (p_request_id, p_category, btrim(p_summary), p_actor_id) returning * into v_case;
    insert into public.operations_work_items(
        department, work_type, status, priority, summary, next_action, due_at, dispute_case_id, created_by
    ) values (
        'disputes', 'dispute_case', 'open', 'high', left('Dispute: ' || btrim(p_summary), 240),
        btrim(p_next_action), p_due_at, v_case.id, p_actor_id
    ) returning * into v_item;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        actor_user_id, next_department, next_status, reason)
    values (v_item.id, 1, 'created', p_actor_type, p_actor_id, 'disputes', 'open', 'Dispute case opened.');
    insert into public.operations_dispute_events(dispute_case_id, sequence_no, actor_id, next_status, note)
    values (v_case.id, 1, p_actor_id, 'open', 'Dispute case opened.');
    return jsonb_build_object('dispute_case', to_jsonb(v_case), 'work_item', to_jsonb(v_item));
end;
$$;

create or replace function public.update_operations_dispute_case(
    p_case_id uuid,
    p_actor_id uuid,
    p_expected_version bigint,
    p_status text,
    p_resolution text default null
) returns public.operations_dispute_cases
language plpgsql security definer set search_path = '' as $$
declare
    v_case public.operations_dispute_cases%rowtype;
    v_item public.operations_work_items%rowtype;
    v_sequence bigint;
    v_work_sequence bigint;
    v_previous_status text;
    v_resolution text := nullif(btrim(coalesce(p_resolution, '')), '');
    v_allowed boolean := false;
    v_actor_type text;
begin
    select * into v_case from public.operations_dispute_cases where id = p_case_id for update;
    if not found then raise exception 'dispute case not found'; end if;
    if v_case.version <> p_expected_version then raise exception 'dispute case version conflict'; end if;
    v_previous_status := v_case.status;
    v_allowed := case v_case.status
        when 'open' then p_status in ('investigating', 'awaiting_member', 'awaiting_supplier', 'resolved', 'closed')
        when 'investigating' then p_status in ('awaiting_member', 'awaiting_supplier', 'resolved', 'closed')
        when 'awaiting_member' then p_status in ('investigating', 'resolved', 'closed')
        when 'awaiting_supplier' then p_status in ('investigating', 'resolved', 'closed')
        when 'resolved' then p_status = 'closed'
        else false end;
    if not v_allowed then raise exception 'invalid dispute status transition'; end if;
    if p_status in ('resolved', 'closed') and v_resolution is null then
        raise exception 'resolution is required to resolve or close a dispute';
    end if;
    update public.operations_dispute_cases set
        status = p_status, resolution = case when p_status in ('resolved', 'closed') then v_resolution else null end,
        version = version + 1, updated_at = now(),
        resolved_at = case when p_status = 'resolved' then now() else null end,
        closed_at = case when p_status = 'closed' then now() else null end
    where id = p_case_id returning * into v_case;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_dispute_events where dispute_case_id = p_case_id;
    insert into public.operations_dispute_events(dispute_case_id, sequence_no, actor_id,
        previous_status, next_status, note)
    values (p_case_id, v_sequence, p_actor_id, v_previous_status, p_status,
        coalesce(v_resolution, 'Dispute status updated to ' || replace(p_status, '_', ' ') || '.'));
    if p_status in ('resolved', 'closed') then
        select * into v_item from public.operations_work_items
         where dispute_case_id = p_case_id for update;
        if found and v_item.status not in ('completed', 'cancelled') then
            v_actor_type := case when exists (
                select 1 from public.fayfort_workers where user_id = p_actor_id
            ) then 'worker' else 'platform_admin' end;
            update public.operations_work_items set status = 'completed', assigned_worker_id = null,
                assigned_automation_key = null, claimed_until = null, waiting_on = null,
                waiting_reason = null, completed_at = now(), version = version + 1, updated_at = now()
            where id = v_item.id;
            select coalesce(max(sequence_no), 0) + 1 into v_work_sequence
              from public.operations_work_events where work_item_id = v_item.id;
            insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
                actor_user_id, previous_department, next_department, previous_status, next_status, reason)
            values (v_item.id, v_work_sequence, 'completed', v_actor_type, p_actor_id,
                v_item.department, v_item.department, v_item.status, 'completed',
                'Dispute case ' || replace(p_status, '_', ' ') || ': ' || v_resolution);
        end if;
    end if;
    return v_case;
end;
$$;

revoke all on function public.create_operations_dispute_case(uuid, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_operations_dispute_case(uuid, text, uuid, text, text, text, timestamptz) to service_role;
revoke all on function public.update_operations_dispute_case(uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.update_operations_dispute_case(uuid, uuid, bigint, text, text) to service_role;

comment on table public.operations_dispute_cases is
    'Staff-only dispute cases linked to canonical member requests; separate from the append-only member request milestone history.';
