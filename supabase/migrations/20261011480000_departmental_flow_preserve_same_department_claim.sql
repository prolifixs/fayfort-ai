-- Keep a worker's Operations lease while request milestones stay in the same
-- department. Department transfers, waiting states, and terminal states still
-- release the claim as before.
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
        claimed_until = case when v_item.department <> v_department or v_status <> 'claimed' then null else v_item.claimed_until end,
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

revoke all on function public.sync_member_request_operations_event() from public, anon, authenticated;
