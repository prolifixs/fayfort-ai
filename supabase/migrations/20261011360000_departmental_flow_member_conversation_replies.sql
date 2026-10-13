-- Send a staff reply from Operations and return the conversation work item to
-- the member-waiting state atomically. The canonical transcript stays in the
-- member chat tables; work history records the operational action.

create or replace function public.send_operations_member_conversation_reply(
    p_work_item_id uuid,
    p_actor_id uuid,
    p_actor_type text,
    p_content text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item public.operations_work_items%rowtype;
    v_conversation public.member_conversations%rowtype;
    v_message public.member_messages%rowtype;
    v_sequence bigint;
begin
    if p_actor_type not in ('worker', 'platform_admin')
       or length(btrim(coalesce(p_content, ''))) not between 1 and 4000 then
        raise exception 'invalid reply';
    end if;

    select * into v_item
      from public.operations_work_items
     where id = p_work_item_id
     for update;
    if not found or v_item.member_conversation_id is null or v_item.member_request_id is not null then
        raise exception 'not a member conversation';
    end if;
    if p_actor_type = 'worker' and (
        v_item.assigned_worker_id is distinct from p_actor_id
        or v_item.status <> 'claimed'
        or v_item.claimed_until is null
        or v_item.claimed_until <= now()
    ) then
        raise exception 'worker not assigned or claim expired';
    end if;

    select * into v_conversation
      from public.member_conversations
     where id = v_item.member_conversation_id
     for update;
    if not found or v_conversation.linked_request_id is not null or v_conversation.retention_hold then
        raise exception 'linked request conversation is read only';
    end if;

    insert into public.member_messages(
        conversation_id, sender_type, actor_user_id, content
    ) values (
        v_conversation.id, 'worker', p_actor_id, btrim(p_content)
    ) returning * into v_message;

    update public.operations_work_items
       set status = 'waiting', next_action = 'Review the member reply and resume this conversation.',
           waiting_on = 'member', waiting_reason = 'Waiting for the member to respond to the staff reply.',
           assigned_worker_id = null, assigned_automation_key = null, claimed_until = null,
           completed_at = null, version = version + 1, updated_at = now()
     where id = v_item.id;

    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events
     where work_item_id = v_item.id;
    insert into public.operations_work_events(
        work_item_id, sequence_no, event_type, actor_type, actor_user_id, previous_department,
        next_department, previous_status, next_status, reason, details
    ) values (
        v_item.id, v_sequence, 'status_changed', p_actor_type, p_actor_id, v_item.department,
        v_item.department, v_item.status, 'waiting', 'Staff replied; waiting for the member.',
        jsonb_build_object('message_id', v_message.id)
    );

    return jsonb_build_object(
        'id', v_message.id, 'sender_type', v_message.sender_type,
        'content', v_message.content, 'related_product_ids', v_message.related_product_ids,
        'created_at', v_message.created_at
    );
end;
$$;

revoke all on function public.send_operations_member_conversation_reply(uuid, uuid, text, text)
    from public, anon, authenticated;
grant execute on function public.send_operations_member_conversation_reply(uuid, uuid, text, text)
    to service_role;

comment on function public.send_operations_member_conversation_reply(uuid, uuid, text, text) is
    'Atomically sends a claimed Operations worker or admin reply to an unlinked member chat and records the work transition.';
