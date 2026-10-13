-- Departmental Flow State foundation: shared staff work items and immutable audit.
-- Domain records (conversations and purchase requests) remain authoritative.

create table if not exists public.operations_worker_departments (
    worker_id uuid not null references public.fayfort_workers(user_id) on delete cascade,
    department text not null check (department in (
        'conversation_intake', 'sourcing', 'fulfillment', 'disputes', 'member_support'
    )),
    can_claim boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (worker_id, department)
);
create table if not exists public.operations_department_events (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references public.fayfort_workers(user_id) on delete cascade,
    department text not null check (department in (
        'conversation_intake', 'sourcing', 'fulfillment', 'disputes', 'member_support'
    )),
    action text not null check (action in ('enabled', 'disabled')),
    actor_id uuid not null references auth.users(id),
    created_at timestamptz not null default now()
);

create table if not exists public.operations_work_items (
    id uuid primary key default gen_random_uuid(),
    department text not null check (department in (
        'conversation_intake', 'sourcing', 'fulfillment', 'disputes', 'member_support'
    )),
    work_type text not null check (length(btrim(work_type)) between 1 and 60),
    status text not null default 'open' check (status in (
        'open', 'claimed', 'waiting', 'blocked', 'completed', 'cancelled'
    )),
    priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
    summary text not null check (length(btrim(summary)) between 1 and 240),
    next_action text not null check (length(btrim(next_action)) between 1 and 500),
    waiting_on text check (waiting_on is null or waiting_on in (
        'member', 'supplier', 'payment', 'carrier', 'automation', 'internal'
    )),
    waiting_reason text check (waiting_reason is null or length(waiting_reason) <= 1000),
    due_at timestamptz,
    assigned_worker_id uuid references public.fayfort_workers(user_id) on delete set null,
    assigned_automation_key text check (
        assigned_automation_key is null or length(btrim(assigned_automation_key)) between 1 and 100
    ),
    claimed_until timestamptz,
    version bigint not null default 1 check (version > 0),
    member_request_id uuid references public.member_purchase_requests(id) on delete cascade,
    member_conversation_id uuid references public.member_conversations(id) on delete cascade,
    business_id uuid references public.businesses(id) on delete cascade,
    business_conversation_id uuid references public.conversations(id) on delete cascade,
    handoff_id uuid references public.conversation_handoffs(id) on delete cascade,
    metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    constraint operations_work_items_single_source check (
        num_nonnulls(member_request_id, member_conversation_id, handoff_id, business_conversation_id) = 1
    ),
    constraint operations_work_items_assignee check (
        not (assigned_worker_id is not null and assigned_automation_key is not null)
    ),
    constraint operations_work_items_claim_lease check (
        claimed_until is null or (assigned_worker_id is not null and status = 'claimed')
    ),
    constraint operations_work_items_waiting_state check (
        (status = 'waiting' and waiting_on is not null and length(btrim(coalesce(waiting_reason, ''))) >= 3)
        or (status <> 'waiting' and waiting_on is null and waiting_reason is null)
    ),
    constraint operations_work_items_terminal_timestamp check (
        (status in ('completed', 'cancelled') and completed_at is not null)
        or (status not in ('completed', 'cancelled') and completed_at is null)
    )
);

create index if not exists idx_operations_work_queue
    on public.operations_work_items(department, status, priority, due_at, created_at)
    where status not in ('completed', 'cancelled');
create index if not exists idx_operations_work_assigned
    on public.operations_work_items(assigned_worker_id, status, due_at)
    where assigned_worker_id is not null and status not in ('completed', 'cancelled');
create index if not exists idx_operations_work_request
    on public.operations_work_items(member_request_id, updated_at desc)
    where member_request_id is not null;
create index if not exists idx_operations_work_conversation
    on public.operations_work_items(member_conversation_id, updated_at desc)
    where member_conversation_id is not null;
create unique index if not exists idx_operations_work_unique_member_request
    on public.operations_work_items(member_request_id) where member_request_id is not null;
create unique index if not exists idx_operations_work_unique_member_conversation
    on public.operations_work_items(member_conversation_id) where member_conversation_id is not null;
create unique index if not exists idx_operations_work_unique_business_handoff
    on public.operations_work_items(handoff_id) where handoff_id is not null;

create table if not exists public.operations_work_events (
    id uuid primary key default gen_random_uuid(),
    work_item_id uuid not null references public.operations_work_items(id) on delete cascade,
    sequence_no bigint not null check (sequence_no > 0),
    event_type text not null check (event_type in (
        'created', 'claimed', 'released', 'assigned', 'transferred', 'status_changed',
        'priority_changed', 'due_date_changed', 'automation_started', 'automation_succeeded',
        'automation_failed', 'reopened', 'completed', 'cancelled'
    )),
    actor_type text not null check (actor_type in ('worker', 'platform_admin', 'automation', 'system')),
    actor_user_id uuid references auth.users(id) on delete set null,
    actor_automation_key text,
    previous_department text,
    next_department text,
    previous_status text,
    next_status text,
    reason text check (reason is null or length(reason) <= 1000),
    details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
    created_at timestamptz not null default now(),
    unique (work_item_id, sequence_no),
    constraint operations_work_events_actor check (
        (actor_type = 'automation' and actor_automation_key is not null and actor_user_id is null)
        or (actor_type in ('worker', 'platform_admin') and actor_user_id is not null and actor_automation_key is null)
        or (actor_type = 'system' and actor_user_id is null and actor_automation_key is null)
    )
);
create index if not exists idx_operations_work_events_history
    on public.operations_work_events(work_item_id, sequence_no);

create table if not exists public.operations_work_checklist_items (
    id uuid primary key default gen_random_uuid(),
    work_item_id uuid not null references public.operations_work_items(id) on delete cascade,
    title text not null check (length(btrim(title)) between 1 and 240),
    position integer not null default 0 check (position between 0 and 10000),
    completed_at timestamptz,
    completed_by uuid references auth.users(id) on delete set null,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((completed_at is null) = (completed_by is null))
);
create index if not exists idx_operations_work_checklist_order
    on public.operations_work_checklist_items(work_item_id, position, created_at);

create table if not exists public.operations_work_notes (
    id uuid primary key default gen_random_uuid(),
    work_item_id uuid not null references public.operations_work_items(id) on delete cascade,
    author_id uuid not null references auth.users(id),
    note text not null check (length(btrim(note)) between 1 and 4000),
    created_at timestamptz not null default now()
);
create index if not exists idx_operations_work_notes_history
    on public.operations_work_notes(work_item_id, created_at);

create or replace function public.prevent_operations_work_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'operations work events are append-only';
end;
$$;
drop trigger if exists operations_work_events_append_only on public.operations_work_events;
create trigger operations_work_events_append_only
    before update or delete on public.operations_work_events
    for each row execute function public.prevent_operations_work_event_mutation();
drop trigger if exists operations_department_events_append_only on public.operations_department_events;
create trigger operations_department_events_append_only
    before update or delete on public.operations_department_events
    for each row execute function public.prevent_operations_work_event_mutation();

create or replace function public.claim_operations_work_item(p_work_item_id uuid, p_worker_id uuid)
returns public.operations_work_items
language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
    v_sequence bigint;
    v_previous_status text;
begin
    if not exists (
        select 1 from public.fayfort_workers worker
        join public.operations_worker_departments department on department.worker_id = worker.user_id
        where worker.user_id = p_worker_id and worker.status = 'active' and department.can_claim
          and department.department = (select work.department from public.operations_work_items work where work.id = p_work_item_id)
    ) then raise exception 'worker is not eligible for this department'; end if;

    select * into v_item from public.operations_work_items where id = p_work_item_id for update;
    if not found then raise exception 'work item not found'; end if;
    if v_item.status in ('completed', 'cancelled') then raise exception 'work item is closed'; end if;
    if v_item.status not in ('open', 'claimed') then raise exception 'work item is waiting or blocked'; end if;
    if v_item.assigned_automation_key is not null then raise exception 'automation owns this work item'; end if;
    if v_item.claimed_until is not null and v_item.claimed_until > now()
       and v_item.assigned_worker_id is distinct from p_worker_id then
        raise exception 'work item is currently claimed';
    end if;
    if v_item.assigned_worker_id is not null and v_item.assigned_worker_id is distinct from p_worker_id
       and (v_item.claimed_until is null or v_item.claimed_until > now()) then
        raise exception 'work item is assigned to another worker';
    end if;
    v_previous_status := v_item.status;

    update public.operations_work_items
       set assigned_worker_id = p_worker_id, assigned_automation_key = null,
           status = 'claimed', claimed_until = now() + interval '15 minutes',
           waiting_on = null, waiting_reason = null, completed_at = null,
           version = version + 1, updated_at = now()
     where id = p_work_item_id returning * into v_item;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = p_work_item_id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        actor_user_id, previous_department, next_department, previous_status, next_status)
    values (p_work_item_id, v_sequence, 'claimed', 'worker', p_worker_id,
        v_item.department, v_item.department, v_previous_status, 'claimed');
    return v_item;
end;
$$;

create or replace function public.create_operations_work_item(
    p_actor_id uuid,
    p_department text,
    p_work_type text,
    p_summary text,
    p_next_action text,
    p_source_type text,
    p_source_id uuid,
    p_priority text default 'normal',
    p_due_at timestamptz default null,
    p_assigned_worker_id uuid default null
) returns public.operations_work_items
language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
begin
    if p_source_type not in ('member_request', 'member_conversation', 'business_handoff', 'business_conversation') then
        raise exception 'unsupported operations work source';
    end if;
    if p_assigned_worker_id is not null and not exists (
        select 1 from public.fayfort_workers worker
        join public.operations_worker_departments department on department.worker_id = worker.user_id
        where worker.user_id = p_assigned_worker_id and worker.status = 'active'
          and department.department = p_department
    ) then raise exception 'worker is not eligible for this department'; end if;
    insert into public.operations_work_items(
        department, work_type, priority, summary, next_action, due_at, assigned_worker_id,
        member_request_id, member_conversation_id, handoff_id, business_conversation_id, created_by
    ) values (
        p_department, p_work_type, p_priority, p_summary, p_next_action, p_due_at, p_assigned_worker_id,
        case when p_source_type = 'member_request' then p_source_id end,
        case when p_source_type = 'member_conversation' then p_source_id end,
        case when p_source_type = 'business_handoff' then p_source_id end,
        case when p_source_type = 'business_conversation' then p_source_id end,
        p_actor_id
    ) returning * into v_item;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type, actor_user_id,
        previous_department, next_department, previous_status, next_status)
    values (v_item.id, 1, 'created', 'platform_admin', p_actor_id,
        null, p_department, null, 'open');
    return v_item;
end;
$$;

create or replace function public.transition_operations_work_item(
    p_work_item_id uuid,
    p_actor_id uuid,
    p_actor_type text,
    p_expected_version bigint,
    p_status text,
    p_next_action text,
    p_waiting_on text default null,
    p_waiting_reason text default null,
    p_due_at timestamptz default null,
    p_reason text default null,
    p_allow_reopen boolean default false
) returns public.operations_work_items
language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
    v_previous_status text;
    v_sequence bigint;
    v_event_type text;
begin
    if p_actor_type not in ('worker', 'platform_admin') then raise exception 'invalid actor type'; end if;
    select * into v_item from public.operations_work_items where id = p_work_item_id for update;
    if not found then raise exception 'work item not found'; end if;
    if v_item.version <> p_expected_version then raise exception 'work item version conflict'; end if;
    if v_item.assigned_automation_key is not null then raise exception 'automation owns this work item'; end if;
    if p_actor_type = 'worker' and v_item.assigned_worker_id is distinct from p_actor_id then
        raise exception 'work item is not assigned to this worker';
    end if;
    v_previous_status := v_item.status;
    if v_previous_status in ('completed', 'cancelled') then
        if not (p_allow_reopen and p_actor_type = 'platform_admin' and p_status = 'open') then
            raise exception 'work item is closed';
        end if;
    elsif not (
        (v_previous_status = 'open' and p_status in ('open', 'cancelled'))
        or (v_previous_status = 'claimed' and p_status in ('claimed', 'waiting', 'blocked', 'open', 'completed', 'cancelled'))
        or (v_previous_status = 'waiting' and p_status in ('waiting', 'claimed', 'blocked', 'open', 'completed', 'cancelled'))
        or (v_previous_status = 'blocked' and p_status in ('blocked', 'claimed', 'waiting', 'open', 'cancelled'))
    ) then raise exception 'invalid work item transition'; end if;
    if p_status = 'waiting' then
        if p_waiting_on is null or length(btrim(coalesce(p_waiting_reason, ''))) < 3 then
            raise exception 'waiting status requires a party and reason';
        end if;
    elsif p_waiting_on is not null or p_waiting_reason is not null then
        raise exception 'waiting details are only valid for waiting status';
    end if;
    if length(btrim(coalesce(p_next_action, ''))) < 1 then raise exception 'next action is required'; end if;
    update public.operations_work_items set
        status = p_status, next_action = btrim(p_next_action), waiting_on = p_waiting_on,
        waiting_reason = nullif(btrim(p_waiting_reason), ''), due_at = p_due_at,
        assigned_worker_id = case when p_status = 'open' and status = 'claimed' then null else assigned_worker_id end,
        claimed_until = case when p_status = 'claimed' then now() + interval '15 minutes' else null end,
        completed_at = case when p_status in ('completed', 'cancelled') then now() else null end,
        version = version + 1, updated_at = now()
    where id = p_work_item_id returning * into v_item;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = p_work_item_id;
    v_event_type := case when v_previous_status in ('completed', 'cancelled') then 'reopened'
                         when v_previous_status = 'claimed' and p_status = 'open' then 'released'
                         when p_status = 'completed' then 'completed'
                         when p_status = 'cancelled' then 'cancelled'
                         else 'status_changed' end;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        actor_user_id, previous_department, next_department, previous_status, next_status, reason)
    values (p_work_item_id, v_sequence, v_event_type, p_actor_type, p_actor_id,
        v_item.department, v_item.department, v_previous_status, p_status, nullif(btrim(p_reason), ''));
    return v_item;
end;
$$;

create or replace function public.transfer_operations_work_item(
    p_work_item_id uuid,
    p_actor_id uuid,
    p_expected_version bigint,
    p_department text,
    p_next_action text,
    p_reason text
) returns public.operations_work_items
language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
    v_previous_department text;
    v_previous_status text;
    v_sequence bigint;
begin
    select * into v_item from public.operations_work_items where id = p_work_item_id for update;
    if not found then raise exception 'work item not found'; end if;
    if v_item.version <> p_expected_version then raise exception 'work item version conflict'; end if;
    if v_item.status in ('completed', 'cancelled') then raise exception 'work item is closed'; end if;
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'transfer reason is required'; end if;
    if length(btrim(coalesce(p_next_action, ''))) < 1 then raise exception 'next action is required'; end if;
    v_previous_department := v_item.department;
    v_previous_status := v_item.status;
    update public.operations_work_items set department = p_department, status = 'open',
        next_action = btrim(p_next_action), waiting_on = null, waiting_reason = null,
        assigned_worker_id = null, assigned_automation_key = null, claimed_until = null,
        completed_at = null, version = version + 1, updated_at = now()
    where id = p_work_item_id returning * into v_item;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = p_work_item_id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        actor_user_id, previous_department, next_department, previous_status, next_status, reason)
    values (p_work_item_id, v_sequence, 'transferred', 'platform_admin', p_actor_id,
        v_previous_department, p_department, v_previous_status, 'open', btrim(p_reason));
    return v_item;
end;
$$;

create or replace function public.set_operations_worker_departments(
    p_actor_id uuid,
    p_worker_id uuid,
    p_departments text[]
) returns setof public.operations_worker_departments
language plpgsql security definer set search_path = '' as $$
declare
    v_department text;
begin
    if not exists (select 1 from public.fayfort_workers where user_id = p_worker_id and status = 'active') then
        raise exception 'only active FayFort workers can receive department access';
    end if;
    if exists (select 1 from unnest(coalesce(p_departments, array[]::text[])) item
        where item not in ('conversation_intake', 'sourcing', 'fulfillment', 'disputes', 'member_support')) then
        raise exception 'unknown operations department';
    end if;
    insert into public.operations_department_events(worker_id, department, action, actor_id)
    select existing_mapping.worker_id, existing_mapping.department, 'disabled', p_actor_id
      from public.operations_worker_departments existing_mapping
     where existing_mapping.worker_id = p_worker_id
       and not (existing_mapping.department = any(coalesce(p_departments, array[]::text[])));
    insert into public.operations_department_events(worker_id, department, action, actor_id)
    select p_worker_id, desired.department, 'enabled', p_actor_id
      from unnest(coalesce(p_departments, array[]::text[])) desired(department)
     where not exists (select 1 from public.operations_worker_departments existing_mapping
        where existing_mapping.worker_id = p_worker_id and existing_mapping.department = desired.department);
    delete from public.operations_worker_departments existing_mapping
     where existing_mapping.worker_id = p_worker_id
       and not (existing_mapping.department = any(coalesce(p_departments, array[]::text[])));
    insert into public.operations_worker_departments(worker_id, department, can_claim, created_by)
    select p_worker_id, desired.department, true, p_actor_id
      from unnest(coalesce(p_departments, array[]::text[])) desired(department)
    on conflict (worker_id, department) do nothing;
    return query select * from public.operations_worker_departments where worker_id = p_worker_id order by department;
end;
$$;

create or replace function public.enqueue_member_purchase_request_for_operations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    v_stage text;
    v_department text := 'sourcing';
    v_status text := 'open';
    v_waiting_on text;
    v_waiting_reason text;
    v_sequence bigint;
    v_item_id uuid;
begin
    select event.stage into v_stage from public.member_request_events event
     where event.request_id = new.id order by event.sequence_no desc limit 1;
    if v_stage in ('delivered', 'cancelled') then return new; end if;
    if v_stage in ('purchase_confirmed', 'item_in_warehouse', 'shipped', 'in_transit', 'out_for_delivery') then
        v_department := 'fulfillment';
    elsif v_stage = 'needs_member_input' then
        v_status := 'waiting';
        v_waiting_on := 'member';
        v_waiting_reason := 'Waiting for the member to provide requested information.';
    end if;
    insert into public.operations_work_items(
        department, work_type, status, priority, summary, next_action,
        waiting_on, waiting_reason, assigned_worker_id, member_request_id, created_by
    ) values (
        v_department, 'member_request', v_status, 'normal', left(new.request_title, 240),
        case when v_status = 'waiting' then 'Review the member response and resume this request.'
             else 'Review the request and record the next sourcing or fulfillment action.' end,
        v_waiting_on, v_waiting_reason, new.assigned_worker_id, new.id, new.member_id
    ) on conflict (member_request_id) where member_request_id is not null do nothing
    returning id into v_item_id;
    if v_item_id is not null then
        insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type)
        values (v_item_id, 1, 'created', 'system');
    end if;
    return new;
end;
$$;

create or replace function public.enqueue_business_handoff_for_operations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    v_item_id uuid;
begin
    insert into public.operations_work_items(
        department, work_type, status, priority, summary, next_action,
        assigned_worker_id, business_id, business_conversation_id, handoff_id, created_by
    ) values (
        'conversation_intake', 'human_handoff',
        case when new.assigned_to is null then 'open' else 'claimed' end,
        'high', left('Human handoff: ' || coalesce(new.reason, 'customer request'), 240),
        'Review the conversation and reply or return control to automation.',
        new.assigned_to, new.business_id, null, new.id, new.requested_by
    ) on conflict (handoff_id) where handoff_id is not null do nothing
    returning id into v_item_id;
    if v_item_id is not null then
        insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type)
        values (v_item_id, 1, 'created', 'system');
    end if;
    return new;
end;
$$;

create or replace function public.sync_member_request_operations_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
    v_department text;
    v_status text;
    v_waiting_on text;
    v_waiting_reason text;
    v_next_action text;
    v_event_type text;
    v_sequence bigint;
begin
    select * into v_item from public.operations_work_items
     where member_request_id = new.request_id for update;
    if not found then return new; end if;
    v_department := case when new.stage in ('purchase_confirmed', 'item_in_warehouse', 'shipped', 'in_transit', 'out_for_delivery', 'delivered')
                         then 'fulfillment' else 'sourcing' end;
    v_status := v_item.status;
    v_waiting_on := null;
    v_waiting_reason := null;
    if new.stage = 'needs_member_input' then
        v_status := 'waiting';
        v_waiting_on := 'member';
        v_waiting_reason := 'Waiting for the member to provide requested information.';
    elsif new.stage in ('delivered', 'cancelled') then
        v_status := case when new.stage = 'delivered' then 'completed' else 'cancelled' end;
    elsif v_item.status in ('waiting', 'completed', 'cancelled') then
        v_status := 'open';
    end if;
    v_next_action := case
        when new.stage = 'needs_member_input' then 'Review the member response and resume sourcing.'
        when new.stage in ('purchase_confirmed', 'item_in_warehouse') then 'Record the next warehouse or fulfillment action.'
        when new.stage in ('shipped', 'in_transit', 'out_for_delivery') then 'Monitor shipment progress and record the next delivery update.'
        when new.stage in ('delivered', 'cancelled') then 'Confirm closeout and resolve any remaining checklist items.'
        else 'Review the request and record the next sourcing action.' end;
    v_event_type := case
        when v_item.department <> v_department then 'transferred'
        when v_item.status in ('completed', 'cancelled') and v_status = 'open' then 'reopened'
        when v_status = 'completed' then 'completed'
        when v_status = 'cancelled' then 'cancelled'
        else 'status_changed' end;
    update public.operations_work_items set
        department = v_department,
        status = v_status,
        next_action = v_next_action,
        waiting_on = v_waiting_on,
        waiting_reason = v_waiting_reason,
        assigned_worker_id = case when v_item.department <> v_department then null else assigned_worker_id end,
        assigned_automation_key = case when v_item.department <> v_department then null else assigned_automation_key end,
        claimed_until = null,
        completed_at = case when v_status in ('completed', 'cancelled') then now() else null end,
        version = version + 1, updated_at = now()
    where id = v_item.id;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = v_item.id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        previous_department, next_department, previous_status, next_status, reason)
    values (v_item.id, v_sequence, v_event_type, 'system', v_item.department, v_department,
        v_item.status, v_status, 'Synchronized from member request milestone: ' || new.stage);
    return new;
end;
$$;

create or replace function public.sync_member_request_operations_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
    v_sequence bigint;
begin
    if new.assigned_worker_id is not distinct from old.assigned_worker_id then return new; end if;
    select * into v_item from public.operations_work_items
     where member_request_id = new.id and status not in ('completed', 'cancelled') for update;
    if not found then return new; end if;
    update public.operations_work_items set
        assigned_worker_id = new.assigned_worker_id,
        assigned_automation_key = null,
        status = case when new.assigned_worker_id is null and status = 'claimed' then 'open' else status end,
        claimed_until = null, version = version + 1, updated_at = now()
    where id = v_item.id;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = v_item.id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        previous_department, next_department, previous_status, next_status, reason)
    values (v_item.id, v_sequence, 'assigned', 'system', v_item.department, v_item.department,
        v_item.status, case when new.assigned_worker_id is null and v_item.status = 'claimed' then 'open' else v_item.status end,
        'Synchronized from member request assignment.');
    return new;
end;
$$;

create or replace function public.sync_business_handoff_operations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
    v_status text;
    v_assignee uuid;
    v_sequence bigint;
begin
    if new.assigned_to is not distinct from old.assigned_to and new.status is not distinct from old.status then return new; end if;
    select * into v_item from public.operations_work_items where handoff_id = new.id for update;
    if not found then return new; end if;
    v_status := case
        when new.status = 'resolved' then 'completed'
        when new.status = 'cancelled' then 'cancelled'
        when new.status = 'returned' then 'open'
        when new.status in ('assigned', 'active') and new.assigned_to is not null then 'claimed'
        else 'open' end;
    v_assignee := case when new.status in ('resolved', 'cancelled', 'returned') then null else new.assigned_to end;
    update public.operations_work_items set
        status = v_status, assigned_worker_id = v_assignee, assigned_automation_key = null,
        next_action = case when v_status in ('completed', 'cancelled') then 'Confirm conversation closeout.'
                           else 'Review the conversation and reply or return control to automation.' end,
        claimed_until = null, completed_at = case when v_status in ('completed', 'cancelled') then now() else null end,
        version = version + 1, updated_at = now()
    where id = v_item.id;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = v_item.id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        previous_department, next_department, previous_status, next_status, reason)
    values (v_item.id, v_sequence, case when v_status = 'cancelled' then 'cancelled'
                                        when v_assignee is distinct from v_item.assigned_worker_id then 'assigned' else 'status_changed' end,
        'system', v_item.department, v_item.department, v_item.status, v_status,
        'Synchronized from human handoff state: ' || new.status);
    return new;
end;
$$;

drop trigger if exists member_request_operations_event_sync on public.member_request_events;
create trigger member_request_operations_event_sync
    after insert on public.member_request_events
    for each row execute function public.sync_member_request_operations_event();
drop trigger if exists member_request_operations_assignment_sync on public.member_purchase_requests;
create trigger member_request_operations_assignment_sync
    after update of assigned_worker_id on public.member_purchase_requests
    for each row execute function public.sync_member_request_operations_assignment();
drop trigger if exists business_handoff_operations_sync on public.conversation_handoffs;
create trigger business_handoff_operations_sync
    after update of assigned_to, status on public.conversation_handoffs
    for each row execute function public.sync_business_handoff_operations();

drop trigger if exists member_purchase_request_operations_enqueue on public.member_purchase_requests;
create trigger member_purchase_request_operations_enqueue
    after insert on public.member_purchase_requests
    for each row execute function public.enqueue_member_purchase_request_for_operations();
drop trigger if exists conversation_handoff_operations_enqueue on public.conversation_handoffs;
create trigger conversation_handoff_operations_enqueue
    after insert on public.conversation_handoffs
    for each row execute function public.enqueue_business_handoff_for_operations();

-- Backfill current actionable human handoffs, retaining existing assignments.
with inserted as (
    insert into public.operations_work_items(
        department, work_type, status, priority, summary, next_action,
        assigned_worker_id, business_id, handoff_id, created_by
    )
    select 'conversation_intake', 'human_handoff',
        case when handoff.assigned_to is null then 'open' else 'claimed' end,
        'high', left('Human handoff: ' || coalesce(handoff.reason, 'customer request'), 240),
        'Review the conversation and reply or return control to automation.',
        handoff.assigned_to, handoff.business_id, handoff.id, handoff.requested_by
    from public.conversation_handoffs handoff
    where handoff.status in ('requested', 'assigned', 'active')
      and not exists (select 1 from public.operations_work_items work where work.handoff_id = handoff.id)
    on conflict (handoff_id) where handoff_id is not null do nothing
    returning id
)
insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type)
select inserted.id, 1, 'created', 'system' from inserted;

-- Backfill every unresolved member request so the operational queue starts complete.
with latest as (
    select distinct on (request.id) request.id, request.request_title,
        request.assigned_worker_id, request.member_id, event.stage
    from public.member_purchase_requests request
    left join public.member_request_events event on event.request_id = request.id
    order by request.id, event.sequence_no desc nulls last
), inserted as (
    insert into public.operations_work_items(
        department, work_type, status, priority, summary, next_action,
        waiting_on, waiting_reason, assigned_worker_id, member_request_id, created_by
    )
    select case when latest.stage in ('purchase_confirmed', 'item_in_warehouse', 'shipped', 'in_transit', 'out_for_delivery')
                    then 'fulfillment' else 'sourcing' end,
        'member_request',
        case when latest.stage = 'needs_member_input' then 'waiting' else 'open' end,
        'normal', left(latest.request_title, 240),
        case when latest.stage = 'needs_member_input'
             then 'Review the member response and resume this request.'
             else 'Review the request and record the next sourcing or fulfillment action.' end,
        case when latest.stage = 'needs_member_input' then 'member' end,
        case when latest.stage = 'needs_member_input'
             then 'Waiting for the member to provide requested information.' end,
        latest.assigned_worker_id, latest.id, latest.member_id
    from latest
    where latest.stage is distinct from 'delivered'
      and latest.stage is distinct from 'cancelled'
      and not exists (select 1 from public.operations_work_items work where work.member_request_id = latest.id)
    returning id
)
insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type)
select inserted.id, 1, 'created', 'system' from inserted;

alter table public.operations_worker_departments enable row level security;
alter table public.operations_department_events enable row level security;
alter table public.operations_work_items enable row level security;
alter table public.operations_work_events enable row level security;
alter table public.operations_work_checklist_items enable row level security;
alter table public.operations_work_notes enable row level security;
revoke all on public.operations_worker_departments, public.operations_department_events, public.operations_work_items,
    public.operations_work_events, public.operations_work_checklist_items,
    public.operations_work_notes from anon, authenticated;
grant all on public.operations_worker_departments, public.operations_department_events, public.operations_work_items,
    public.operations_work_events, public.operations_work_checklist_items,
    public.operations_work_notes to service_role;
revoke all on function public.prevent_operations_work_event_mutation() from public, anon, authenticated;
revoke all on function public.claim_operations_work_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_operations_work_item(uuid, uuid) to service_role;
revoke all on function public.create_operations_work_item(uuid, text, text, text, text, text, uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.create_operations_work_item(uuid, text, text, text, text, text, uuid, text, timestamptz, uuid) to service_role;
revoke all on function public.transition_operations_work_item(uuid, uuid, text, bigint, text, text, text, text, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.transition_operations_work_item(uuid, uuid, text, bigint, text, text, text, text, timestamptz, text, boolean) to service_role;
revoke all on function public.transfer_operations_work_item(uuid, uuid, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.transfer_operations_work_item(uuid, uuid, bigint, text, text, text) to service_role;
revoke all on function public.set_operations_worker_departments(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.set_operations_worker_departments(uuid, uuid, text[]) to service_role;
revoke all on function public.enqueue_member_purchase_request_for_operations() from public, anon, authenticated;
revoke all on function public.enqueue_business_handoff_for_operations() from public, anon, authenticated;
revoke all on function public.sync_member_request_operations_event() from public, anon, authenticated;
revoke all on function public.sync_member_request_operations_assignment() from public, anon, authenticated;
revoke all on function public.sync_business_handoff_operations() from public, anon, authenticated;
revoke all on function public.set_operations_worker_departments(uuid, uuid, text[]) from public, anon, authenticated;

comment on table public.operations_work_items is
    'Shared FayFort staff operations queue. Domain records remain canonical; this table stores accountable work state.';
comment on table public.operations_work_events is
    'Append-only audit history for assignment, department handoff, status, automation, and closeout actions.';
comment on table public.operations_work_notes is
    'Staff-only operational notes; never projected through member APIs.';
