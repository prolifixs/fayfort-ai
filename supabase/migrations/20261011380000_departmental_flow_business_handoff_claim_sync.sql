-- Keep the Operations queue claim and canonical business handoff owner in sync.
-- The business handoff remains the source of conversation lifecycle state.

create or replace function public.claim_operations_work_item(p_work_item_id uuid, p_worker_id uuid)
returns public.operations_work_items
language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
    v_candidate public.operations_work_items%rowtype;
    v_handoff public.conversation_handoffs%rowtype;
    v_sequence bigint;
    v_previous_status text;
    v_handoff_changed boolean := false;
begin
    if not exists (
        select 1 from public.fayfort_workers worker
        join public.operations_worker_departments department on department.worker_id = worker.user_id
        where worker.user_id = p_worker_id and worker.status = 'active' and department.can_claim
          and department.department = (select work.department from public.operations_work_items work where work.id = p_work_item_id)
    ) then raise exception 'worker is not eligible for this department'; end if;

    -- Lock order is handoff, then work item, matching the business-handoff sync trigger.
    select * into v_candidate from public.operations_work_items where id = p_work_item_id;
    if not found then raise exception 'work item not found'; end if;
    if v_candidate.handoff_id is not null then
        select * into v_handoff from public.conversation_handoffs
         where id = v_candidate.handoff_id and business_id = v_candidate.business_id for update;
        if not found then raise exception 'business handoff not found'; end if;
    end if;

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

    if v_item.handoff_id is not null then
        if v_handoff.status not in ('requested', 'assigned', 'active') then
            raise exception 'business handoff is no longer actionable';
        end if;
        if v_handoff.assigned_to is not null and v_handoff.assigned_to is distinct from p_worker_id
           and (v_item.assigned_worker_id is distinct from v_handoff.assigned_to
                or v_item.claimed_until is null or v_item.claimed_until > now()) then
            raise exception 'business handoff is assigned to another worker';
        end if;
        v_handoff_changed := v_handoff.status <> 'active' or v_handoff.assigned_to is distinct from p_worker_id;
    end if;
    v_previous_status := v_item.status;

    update public.operations_work_items
       set assigned_worker_id = p_worker_id, assigned_automation_key = null,
           status = 'claimed', claimed_until = now() + interval '15 minutes',
           waiting_on = null, waiting_reason = null, completed_at = null,
           version = version + 1, updated_at = now()
     where id = p_work_item_id returning * into v_item;

    if v_item.handoff_id is not null then
        update public.conversation_handoffs
           set assigned_to = p_worker_id, status = 'active', closed_at = null
         where id = v_handoff.id;
        if v_handoff_changed then
            insert into public.conversation_handoff_events(business_id, handoff_id, actor_id, event_type, details)
            values (v_handoff.business_id, v_handoff.id, p_worker_id, 'taken_over',
                    jsonb_build_object('source', 'operations_center'));
        end if;
    end if;

    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = p_work_item_id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        actor_user_id, previous_department, next_department, previous_status, next_status)
    values (p_work_item_id, v_sequence, 'claimed', 'worker', p_worker_id,
        v_item.department, v_item.department, v_previous_status, 'claimed');
    return v_item;
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
    select * into v_item from public.operations_work_items
     where handoff_id = new.id and business_id = new.business_id for update;
    if not found then return new; end if;

    v_status := case
        when new.status in ('resolved', 'returned') then 'completed'
        when new.status = 'cancelled' then 'cancelled'
        when new.status in ('assigned', 'active') and new.assigned_to is not null then 'claimed'
        else 'open' end;
    v_assignee := case when new.status in ('resolved', 'cancelled', 'returned') then null else new.assigned_to end;

    -- A queue claim updates the work row first, then the canonical handoff.
    -- Do not erase that claim's lease or create a duplicate sync event.
    if v_status = 'claimed' and v_item.status = 'claimed'
       and v_item.assigned_worker_id is not distinct from v_assignee
       and v_item.assigned_automation_key is null then
        return new;
    end if;

    update public.operations_work_items set
        status = v_status, assigned_worker_id = v_assignee, assigned_automation_key = null,
        next_action = case when v_status = 'completed' then 'Confirm conversation closeout.'
                           when v_status = 'cancelled' then 'Confirm cancellation closeout.'
                           else 'Review the conversation and reply or return control to automation.' end,
        claimed_until = case when v_status = 'claimed' then now() + interval '15 minutes' else null end,
        waiting_on = null, waiting_reason = null,
        completed_at = case when v_status in ('completed', 'cancelled') then now() else null end,
        version = version + 1, updated_at = now()
    where id = v_item.id;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = v_item.id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        previous_department, next_department, previous_status, next_status, reason)
    values (v_item.id, v_sequence,
        case when v_status = 'cancelled' then 'cancelled'
             when v_status = 'completed' and v_item.status not in ('completed', 'cancelled') then 'completed'
             when v_assignee is distinct from v_item.assigned_worker_id then 'assigned'
             else 'status_changed' end,
        'system', v_item.department, v_item.department, v_item.status, v_status,
        'Synchronized from human handoff state: ' || new.status);
    return new;
end;
$$;

revoke all on function public.claim_operations_work_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_operations_work_item(uuid, uuid) to service_role;
revoke all on function public.sync_business_handoff_operations() from public, anon, authenticated;

