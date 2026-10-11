-- L8 follow-up: persistent in-app member notifications.
-- Notifications are generated transactionally from existing source records.

create table if not exists public.member_notifications (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    notification_type text not null check (notification_type in (
        'request_milestone', 'worker_reply', 'photo_review_status'
    )),
    request_event_id uuid references public.member_request_events(id) on delete cascade,
    worker_message_id uuid references public.member_messages(id) on delete cascade,
    review_id uuid references public.member_chat_reviews(id) on delete cascade,
    review_status text check (review_status is null or review_status in ('assigned', 'under_review', 'reviewed')),
    created_at timestamptz not null default now(),
    read_at timestamptz,
    banner_dismissed_at timestamptz,
    constraint member_notifications_source_check check (
        (notification_type = 'request_milestone' and request_event_id is not null
            and worker_message_id is null and review_id is null and review_status is null)
        or (notification_type = 'worker_reply' and request_event_id is null
            and worker_message_id is not null and review_id is null and review_status is null)
        or (notification_type = 'photo_review_status' and request_event_id is null
            and worker_message_id is null and review_id is not null and review_status is not null)
    )
);

create unique index if not exists idx_member_notifications_request_event
    on public.member_notifications(request_event_id) where request_event_id is not null;
create unique index if not exists idx_member_notifications_worker_message
    on public.member_notifications(worker_message_id) where worker_message_id is not null;
create unique index if not exists idx_member_notifications_review_status
    on public.member_notifications(review_id, review_status) where review_id is not null;
create index if not exists idx_member_notifications_member_created
    on public.member_notifications(member_id, created_at desc, id desc);
create index if not exists idx_member_notifications_member_unread
    on public.member_notifications(member_id, created_at desc) where read_at is null;
create index if not exists idx_member_notifications_member_banner
    on public.member_notifications(member_id, created_at desc)
    where read_at is null and banner_dismissed_at is null;

alter table public.member_notifications enable row level security;
revoke all on public.member_notifications from anon, authenticated;
grant all on public.member_notifications to service_role;

create or replace function public.notify_member_request_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.member_notifications(member_id, notification_type, request_event_id)
    select request.member_id, 'request_milestone', new.id
    from public.member_purchase_requests request
    where request.id = new.request_id
    on conflict (request_event_id) where request_event_id is not null do nothing;
    return new;
end;
$$;

drop trigger if exists member_request_event_notification on public.member_request_events;
create trigger member_request_event_notification
    after insert on public.member_request_events
    for each row execute function public.notify_member_request_milestone();

create or replace function public.notify_member_worker_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.sender_type = 'worker' then
        insert into public.member_notifications(member_id, notification_type, worker_message_id)
        select conversation.member_id, 'worker_reply', new.id
        from public.member_conversations conversation
        where conversation.id = new.conversation_id
        on conflict (worker_message_id) where worker_message_id is not null do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists member_worker_reply_notification on public.member_messages;
create trigger member_worker_reply_notification
    after insert on public.member_messages
    for each row execute function public.notify_member_worker_reply();

create or replace function public.notify_member_photo_review_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.status in ('assigned', 'under_review', 'reviewed')
       and (tg_op = 'INSERT' or new.status is distinct from old.status) then
        insert into public.member_notifications(
            member_id, notification_type, review_id, review_status
        ) values (new.member_id, 'photo_review_status', new.id, new.status)
        on conflict (review_id, review_status) where review_id is not null do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists member_photo_review_status_notification on public.member_chat_reviews;
create trigger member_photo_review_status_notification
    after insert or update on public.member_chat_reviews
    for each row execute function public.notify_member_photo_review_status();

revoke all on function public.notify_member_request_milestone() from public, anon, authenticated;
revoke all on function public.notify_member_worker_reply() from public, anon, authenticated;
revoke all on function public.notify_member_photo_review_status() from public, anon, authenticated;

comment on table public.member_notifications is
    'Member-owned in-app alerts derived transactionally from request events, human worker replies, and photo review status. Source deletion cascades the alert.';
comment on column public.member_notifications.banner_dismissed_at is
    'Dismisses the activity banner independently of inbox read state.';
