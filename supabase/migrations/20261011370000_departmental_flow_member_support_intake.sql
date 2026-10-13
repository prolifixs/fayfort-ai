-- Create one accountable conversation-intake work item only when the member
-- explicitly requests staff help. Repeated clicks reuse/reopen that item.

create or replace function public.request_member_conversation_support(
    p_member_id uuid,
    p_conversation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conversation public.member_conversations%rowtype;
    v_item public.operations_work_items%rowtype;
    v_previous_status text;
    v_sequence bigint;
begin
    select * into v_conversation
      from public.member_conversations
     where id = p_conversation_id and member_id = p_member_id
     for update;
    if not found then raise exception 'conversation not found or not owned'; end if;
    if v_conversation.linked_request_id is not null or v_conversation.retention_hold then
        raise exception 'linked request conversation is read only';
    end if;

    select * into v_item
      from public.operations_work_items
     where member_conversation_id = p_conversation_id
     for update;
    if not found then
        insert into public.operations_work_items(
            department, work_type, status, priority, summary, next_action,
            member_conversation_id, created_by
        ) values (
            'conversation_intake', 'member_conversation', 'open', 'normal',
            left(coalesce(v_conversation.title, 'Member chat'), 240),
            'Review the member conversation and provide staff support.',
            p_conversation_id, p_member_id
        ) returning * into v_item;
        insert into public.operations_work_events(
            work_item_id, sequence_no, event_type, actor_type, reason, details
        ) values (
            v_item.id, 1, 'created', 'system', 'Member requested staff support.',
            jsonb_build_object('source', 'member_support_request')
        );
    elsif v_item.status in ('waiting', 'completed', 'cancelled') then
        v_previous_status := v_item.status;
        update public.operations_work_items
           set status = 'open', assigned_worker_id = null, assigned_automation_key = null,
               claimed_until = null, waiting_on = null, waiting_reason = null,
               completed_at = null, next_action = 'Review the member conversation and provide staff support.',
               version = version + 1, updated_at = now()
         where id = v_item.id
         returning * into v_item;
        select coalesce(max(sequence_no), 0) + 1 into v_sequence
          from public.operations_work_events where work_item_id = v_item.id;
        insert into public.operations_work_events(
            work_item_id, sequence_no, event_type, actor_type,
            previous_department, next_department, previous_status, next_status,
            reason, details
        ) values (
            v_item.id, v_sequence, 'reopened', 'system',
            v_item.department, v_item.department, v_previous_status, 'open',
            'Member requested staff support.', jsonb_build_object('source', 'member_support_request')
        );
    end if;

    return jsonb_build_object('id', v_item.id, 'status', v_item.status);
end;
$$;

revoke all on function public.request_member_conversation_support(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.request_member_conversation_support(uuid, uuid)
    to service_role;

comment on function public.request_member_conversation_support(uuid, uuid) is
    'Creates or reopens one Operations conversation item after an authenticated member explicitly asks for staff support.';
