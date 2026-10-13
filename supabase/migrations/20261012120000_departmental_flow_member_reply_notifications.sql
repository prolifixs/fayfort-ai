-- Notify the previous human owner when a new member reply reopens an
-- unlinked conversation task that was waiting on the member.
-- Linked request conversations remain governed by the request lifecycle.

alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in ('assigned', 'reassigned', 'member_replied'));

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

comment on table public.operations_worker_notifications is
    'Private staff inbox. Initial events: direct assignment, reassignment, and member reply reopening an unlinked conversation.';
