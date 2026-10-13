-- Return a human conversation task to the shared queue when its member replies.
-- Only applies to unlinked discovery chats explicitly waiting on the member.
-- The reply itself remains canonical in member_messages; this records only the
-- operational queue transition and an append-only audit event.

create or replace function public.reopen_operations_conversation_on_member_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item public.operations_work_items%rowtype;
    v_sequence bigint;
begin
    if new.sender_type <> 'member' then
        return new;
    end if;

    if exists (
        select 1 from public.member_conversations conversation
        where conversation.id = new.conversation_id
          and conversation.linked_request_id is not null
    ) then
        return new;
    end if;

    for v_item in
        select * from public.operations_work_items work
        where work.member_conversation_id = new.conversation_id
          and work.status = 'waiting'
          and work.waiting_on = 'member'
        for update
    loop
        update public.operations_work_items
           set status = 'open', assigned_worker_id = null, assigned_automation_key = null,
               claimed_until = null, waiting_on = null, waiting_reason = null,
               completed_at = null, version = version + 1, updated_at = now()
         where id = v_item.id
         returning * into v_item;

        select coalesce(max(sequence_no), 0) + 1 into v_sequence
          from public.operations_work_events event
         where event.work_item_id = v_item.id;

        insert into public.operations_work_events(
            work_item_id, sequence_no, event_type, actor_type,
            previous_department, next_department, previous_status, next_status,
            reason, details
        ) values (
            v_item.id, v_sequence, 'status_changed', 'system',
            v_item.department, v_item.department, 'waiting', 'open',
            'A new member reply returned this conversation to the queue.',
            jsonb_build_object('trigger', 'member_reply')
        );
    end loop;

    return new;
end;
$$;

revoke all on function public.reopen_operations_conversation_on_member_reply() from public, anon, authenticated;
grant execute on function public.reopen_operations_conversation_on_member_reply() to service_role;

drop trigger if exists member_reply_reopens_operations_conversation on public.member_messages;
create trigger member_reply_reopens_operations_conversation
    after insert on public.member_messages
    for each row execute function public.reopen_operations_conversation_on_member_reply();

comment on function public.reopen_operations_conversation_on_member_reply() is
    'Requeues only unlinked member conversations waiting on a member; leaves linked purchase-request chats unchanged.';
