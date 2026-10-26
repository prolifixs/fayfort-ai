-- Operations fixes, phase A (docs/OPERATIONS_FIXES_PLAN.md):
-- 1. Staff take over a member chat from the AI and hand it back.
-- 2. A member deleting a chat that staff worked on hides it for them; the staff copy and its history stay.
-- 3. Notifications for what was missing: member messages in chats staff are handling, new work in your departments,
--    payments, bookings and tour requests, and finished work (for administrators).
-- Safe to run again.

-- 1 and 2. Member chats.
alter table public.member_conversations
    add column if not exists staff_takeover_by uuid references auth.users(id) on delete set null,
    add column if not exists staff_takeover_at timestamptz,
    add column if not exists member_hidden_at timestamptz;
comment on column public.member_conversations.staff_takeover_at is
    'A FayFort person took this chat over from the AI. The AI stays quiet until they hand it back or go quiet for the idle window.';
comment on column public.member_conversations.member_hidden_at is
    'The member deleted this chat, but staff worked on it, so it is hidden for the member and kept for the team.';

-- 3. Notification types.
alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in (
        'assigned', 'reassigned', 'member_replied', 'mentioned',
        'work_due', 'work_overdue', 'automation_failed', 'infrastructure_alert',
        'review_needed', 'review_done',
        'member_message', 'new_work', 'payment_received', 'booking', 'tour_booking', 'work_done'
    ));

-- Who is an administrator.
create or replace function public.platform_admin_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
    select users.id from auth.users as users
     where users.raw_app_meta_data ->> 'platform_admin' = 'true'
        or coalesce(users.raw_app_meta_data -> 'roles', '[]'::jsonb) @> '["platform_admin"]'::jsonb;
$$;
revoke all on function public.platform_admin_ids() from public, anon, authenticated;
grant execute on function public.platform_admin_ids() to service_role;

-- Active workers who can take work in a department.
create or replace function public.department_worker_ids(p_department text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
    select mapping.worker_id from public.operations_worker_departments mapping
      join public.fayfort_workers worker on worker.user_id = mapping.worker_id and worker.status = 'active'
     where mapping.department = p_department and mapping.can_claim;
$$;
revoke all on function public.department_worker_ids(text) from public, anon, authenticated;
grant execute on function public.department_worker_ids(text) to service_role;

-- 3a. A member writes in a chat that has live staff work: the person handling it hears about it (or the department
--     and administrators when nobody has it). At most one notice per chat and person every 10 minutes. When the item
--     was waiting for the member, the existing "member replied" notice covers it.
create or replace function public.notify_staff_on_member_message()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    v_item public.operations_work_items%rowtype;
    v_bucket text;
begin
    if new.sender_type <> 'member' then
        return new;
    end if;
    select * into v_item from public.operations_work_items work
     where work.member_conversation_id = new.conversation_id
       and work.status in ('open', 'claimed', 'waiting', 'blocked')
     order by work.created_at desc limit 1;
    if not found then
        return new;
    end if;
    if exists (select 1 from public.operations_worker_notifications notice
                where notice.dedupe_key like 'member-reply:' || v_item.id::text || ':' || new.id::text || ':%') then
        return new;
    end if;
    if v_item.status = 'waiting' and v_item.waiting_on = 'member' then
        return new;
    end if;
    v_bucket := floor(extract(epoch from new.created_at) / 600)::bigint::text;
    insert into public.operations_worker_notifications(worker_id, work_item_id, notification_type, title, body, href, dedupe_key)
    select recipient, v_item.id, 'member_message', 'New message from a member',
           left('In "' || coalesce(v_item.summary, 'a member chat') || '": ' || left(btrim(new.content), 240), 500),
           '/operations?workItem=' || v_item.id::text,
           'member-msg:' || v_item.id::text || ':' || recipient::text || ':' || v_bucket
      from (
        select v_item.assigned_worker_id as recipient where v_item.assigned_worker_id is not null
        union
        select id from public.department_worker_ids(v_item.department) as id where v_item.assigned_worker_id is null
        union
        select id from public.platform_admin_ids() as id
      ) recipients
     where recipient is not null
    on conflict (dedupe_key) do nothing;
    return new;
end;
$$;
revoke all on function public.notify_staff_on_member_message() from public, anon, authenticated;
drop trigger if exists member_message_notifies_staff on public.member_messages;
create trigger member_message_notifies_staff
    after insert on public.member_messages
    for each row execute function public.notify_staff_on_member_message();

-- 3b. New unassigned work: everyone who can take it in that department, and administrators.
create or replace function public.notify_staff_on_new_work()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if new.assigned_worker_id is not null or new.assigned_automation_key is not null
       or new.status not in ('open', 'claimed', 'waiting', 'blocked') then
        return new;
    end if;
    insert into public.operations_worker_notifications(worker_id, work_item_id, notification_type, title, body, href, dedupe_key)
    select recipient, new.id, 'new_work',
           left('New in ' || initcap(replace(new.department, '_', ' ')), 160),
           left(coalesce(nullif(btrim(new.summary), ''), 'New work item'), 500),
           '/operations?workItem=' || new.id::text,
           'new-work:' || new.id::text || ':' || recipient::text
      from (select id as recipient from public.department_worker_ids(new.department) as id
            union select id from public.platform_admin_ids() as id) recipients
    on conflict (dedupe_key) do nothing;
    return new;
end;
$$;
revoke all on function public.notify_staff_on_new_work() from public, anon, authenticated;
drop trigger if exists new_work_notifies_staff on public.operations_work_items;
create trigger new_work_notifies_staff
    after insert on public.operations_work_items
    for each row execute function public.notify_staff_on_new_work();

-- 3c. A worker finishes work: administrators see it.
create or replace function public.notify_admins_on_work_done()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if new.status <> 'completed' or old.status = 'completed' or new.assigned_worker_id is null then
        return new;
    end if;
    insert into public.operations_worker_notifications(worker_id, work_item_id, notification_type, title, body, href, dedupe_key)
    select admin_id, new.id, 'work_done', 'Work finished',
           left(coalesce(nullif(btrim(new.summary), ''), 'A work item') || ' was marked done.', 500),
           '/operations?workItem=' || new.id::text,
           'work-done:' || new.id::text || ':' || new.version::text || ':' || admin_id::text
      from public.platform_admin_ids() as admin_id
     where admin_id <> new.assigned_worker_id
    on conflict (dedupe_key) do nothing;
    return new;
end;
$$;
revoke all on function public.notify_admins_on_work_done() from public, anon, authenticated;
drop trigger if exists work_done_notifies_admins on public.operations_work_items;
create trigger work_done_notifies_admins
    after update of status on public.operations_work_items
    for each row execute function public.notify_admins_on_work_done();

-- 3d. A FayFort invoice is paid: administrators, and whoever has the request's live work.
create or replace function public.notify_staff_on_invoice_paid()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    v_item_id uuid;
    v_worker uuid;
begin
    if new.status <> 'paid' or old.status = 'paid' then
        return new;
    end if;
    if new.request_id is not null then
        select work.id, work.assigned_worker_id into v_item_id, v_worker from public.operations_work_items work
         where work.member_request_id = new.request_id and work.status in ('open', 'claimed', 'waiting', 'blocked')
         order by work.created_at desc limit 1;
    end if;
    insert into public.operations_worker_notifications(worker_id, work_item_id, notification_type, title, body, href, dedupe_key)
    select recipient, v_item_id, 'payment_received', 'Payment received',
           left(coalesce(nullif(btrim(new.title), ''), initcap(new.kind) || ' invoice') || ': '
                || coalesce(new.amount::text, '') || ' ' || coalesce(new.currency, ''), 500),
           case when v_item_id is null then '/operations' else '/operations?workItem=' || v_item_id::text end,
           'invoice-paid:' || new.id::text || ':' || recipient::text
      from (select v_worker as recipient where v_worker is not null
            union select id from public.platform_admin_ids() as id) recipients
     where recipient is not null
    on conflict (dedupe_key) do nothing;
    return new;
end;
$$;
revoke all on function public.notify_staff_on_invoice_paid() from public, anon, authenticated;
drop trigger if exists invoice_paid_notifies_staff on public.commerce_invoices;
create trigger invoice_paid_notifies_staff
    after update of status on public.commerce_invoices
    for each row execute function public.notify_staff_on_invoice_paid();
