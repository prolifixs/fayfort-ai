-- Notify active FayFort coworkers mentioned in staff-only Operations notes.
-- Member-facing replies and business-channel messages are intentionally excluded.

alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in ('assigned', 'reassigned', 'member_replied', 'mentioned'));

create or replace function public.notify_operations_work_note_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token text;
    v_email text;
    v_worker_id uuid;
    v_item public.operations_work_items%rowtype;
begin
    select * into v_item
      from public.operations_work_items as work
     where work.id = new.work_item_id;
    if not found then
        return new;
    end if;

    for v_token in
        select distinct lower(rtrim(token, '.!?'))
          from regexp_split_to_table(new.note, '[[:space:],;<>()]') as tokens(token)
         where left(token, 1) = '@'
    loop
        v_email := substr(v_token, 2);
        if v_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$' then
            continue;
        end if;

        select users.id into v_worker_id
          from auth.users as users
          join public.fayfort_workers as workers on workers.user_id = users.id
         where lower(users.email) = v_email
           and workers.status = 'active'
           and users.id <> new.author_id
           and (
                v_item.assigned_worker_id = users.id
                or exists (
                    select 1 from public.operations_worker_departments as access
                     where access.worker_id = users.id
                       and access.department = v_item.department
                       and access.can_claim = true
                )
           )
         limit 1;

        if v_worker_id is not null then
            insert into public.operations_worker_notifications(
                worker_id, work_item_id, notification_type, title, body, href, dedupe_key
            ) values (
                v_worker_id,
                new.work_item_id,
                'mentioned',
                'You were mentioned in an Operations note',
                left('A coworker mentioned you: ' || new.note, 500),
                '/operations?workItem=' || new.work_item_id::text,
                'note-mention:' || new.id::text || ':' || v_worker_id::text
            ) on conflict (dedupe_key) do nothing;
        end if;
    end loop;

    return new;
end;
$$;

drop trigger if exists operations_work_note_mention_notifications on public.operations_work_notes;
create trigger operations_work_note_mention_notifications
    after insert on public.operations_work_notes
    for each row execute function public.notify_operations_work_note_mentions();

revoke all on function public.notify_operations_work_note_mentions() from public, anon, authenticated;
grant execute on function public.notify_operations_work_note_mentions() to service_role;

comment on function public.notify_operations_work_note_mentions() is
    'Notifies active FayFort workers with access to the item when named with @email in a private Operations note; deduplicated per note and worker.';
comment on table public.operations_worker_notifications is
    'Private staff inbox for assignment, reassignment, member reply, and internal-note mention events.';
