-- The member-reply trigger runs after the staff-reply RPC has released the
-- claim, so use the audited worker reply as the notification recipient.
create or replace function public.reopen_operations_conversation_on_member_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item public.operations_work_items%rowtype;
    v_sequence bigint;
    v_previous_worker_id uuid;
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
        v_previous_worker_id := v_item.assigned_worker_id;
        if v_previous_worker_id is null then
            select event.actor_user_id into v_previous_worker_id
              from public.operations_work_events event
             where event.work_item_id = v_item.id
               and event.event_type = 'status_changed'
               and event.next_status = 'waiting'
               and event.actor_type = 'worker'
               and event.actor_user_id is not null
             order by event.sequence_no desc
             limit 1;
        end if;

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

        if v_previous_worker_id is not null then
            insert into public.operations_worker_notifications(
                worker_id, work_item_id, notification_type, title, body, href, dedupe_key
            ) values (
                v_previous_worker_id,
                v_item.id,
                'member_replied',
                'Member replied',
                left('A member replied in "' || v_item.summary || '". Review the conversation.', 500),
                '/operations?workItem=' || v_item.id::text,
                'member-reply:' || v_item.id::text || ':' || new.id::text || ':' || v_previous_worker_id::text
            ) on conflict (dedupe_key) do nothing;
        end if;
    end loop;

    return new;
end;
$$;

revoke all on function public.reopen_operations_conversation_on_member_reply() from public, anon, authenticated;
grant execute on function public.reopen_operations_conversation_on_member_reply() to service_role;
