-- Atomic Operations actions for a claimed business conversation handoff.

create or replace function public.send_operations_business_handoff_reply(
    p_work_item_id uuid,
    p_actor_id uuid,
    p_content text
) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
    v_candidate public.operations_work_items%rowtype;
    v_item public.operations_work_items%rowtype;
    v_handoff public.conversation_handoffs%rowtype;
    v_message public.messages%rowtype;
    v_sequence bigint;
begin
    if length(btrim(coalesce(p_content, ''))) < 1 or length(p_content) > 4000 then
        raise exception 'reply must contain 1 to 4000 characters';
    end if;
    select * into v_candidate from public.operations_work_items where id = p_work_item_id;
    if not found or v_candidate.handoff_id is null then raise exception 'business handoff work item not found'; end if;
    select * into v_handoff from public.conversation_handoffs
     where id = v_candidate.handoff_id and business_id = v_candidate.business_id for update;
    if not found then raise exception 'business handoff not found'; end if;
    select * into v_item from public.operations_work_items where id = p_work_item_id for update;
    if not found or v_item.handoff_id is distinct from v_handoff.id then raise exception 'business handoff work item not found'; end if;
    if v_item.status <> 'claimed' or v_item.assigned_worker_id is distinct from p_actor_id
       or v_item.claimed_until is null or v_item.claimed_until <= now() then
        raise exception 'worker must hold an active Operations claim';
    end if;
    if v_handoff.status <> 'active' or v_handoff.assigned_to is distinct from p_actor_id then
        raise exception 'worker must own the active business handoff';
    end if;

    insert into public.messages(conversation_id, external_message_id, sender_type, agent_id, content)
    values (v_handoff.conversation_id, gen_random_uuid()::text, 'agent', p_actor_id, btrim(p_content))
    returning * into v_message;

    update public.operations_work_items set version = version + 1, updated_at = now()
     where id = v_item.id;
    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = v_item.id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
        actor_user_id, previous_department, next_department, previous_status, next_status, reason, details)
    values (v_item.id, v_sequence, 'status_changed', 'worker', p_actor_id,
        v_item.department, v_item.department, v_item.status, v_item.status,
        'Staff reply sent from Operations Center.', jsonb_build_object('action', 'business_handoff_reply'));
    return v_message;
end;
$$;

create or replace function public.return_operations_business_handoff_to_automation(
    p_work_item_id uuid,
    p_actor_id uuid
) returns public.operations_work_items
language plpgsql security definer set search_path = '' as $$
declare
    v_candidate public.operations_work_items%rowtype;
    v_item public.operations_work_items%rowtype;
    v_handoff public.conversation_handoffs%rowtype;
begin
    select * into v_candidate from public.operations_work_items where id = p_work_item_id;
    if not found or v_candidate.handoff_id is null then raise exception 'business handoff work item not found'; end if;
    select * into v_handoff from public.conversation_handoffs
     where id = v_candidate.handoff_id and business_id = v_candidate.business_id for update;
    if not found then raise exception 'business handoff not found'; end if;
    select * into v_item from public.operations_work_items where id = p_work_item_id for update;
    if not found or v_item.handoff_id is distinct from v_handoff.id then raise exception 'business handoff work item not found'; end if;
    if v_item.status <> 'claimed' or v_item.assigned_worker_id is distinct from p_actor_id
       or v_item.claimed_until is null or v_item.claimed_until <= now() then
        raise exception 'worker must hold an active Operations claim';
    end if;
    if v_handoff.status <> 'active' or v_handoff.assigned_to is distinct from p_actor_id then
        raise exception 'worker must own the active business handoff';
    end if;

    update public.conversation_handoffs set status = 'returned', closed_at = now()
     where id = v_handoff.id and business_id = v_handoff.business_id;
    insert into public.conversation_handoff_events(business_id, handoff_id, actor_id, event_type, details)
    values (v_handoff.business_id, v_handoff.id, p_actor_id, 'returned_to_automation',
            jsonb_build_object('source', 'operations_center'));
    select * into v_item from public.operations_work_items where id = p_work_item_id;
    return v_item;
end;
$$;

revoke all on function public.send_operations_business_handoff_reply(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.send_operations_business_handoff_reply(uuid, uuid, text) to service_role;
revoke all on function public.return_operations_business_handoff_to_automation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.return_operations_business_handoff_to_automation(uuid, uuid) to service_role;

