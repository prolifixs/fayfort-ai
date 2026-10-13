-- Notify members when their recurring request schedule changes.
-- Events remain the source of truth; this adds only idempotent in-app alerts.

alter table public.member_notifications
    add column if not exists schedule_event_id uuid
        references public.member_request_schedule_events(id) on delete cascade;

alter table public.member_notifications
    drop constraint if exists member_notifications_notification_type_check;
alter table public.member_notifications
    add constraint member_notifications_notification_type_check check (notification_type in (
        'request_milestone', 'worker_reply', 'photo_review_status', 'recurring_schedule_update'
    ));

alter table public.member_notifications
    drop constraint if exists member_notifications_source_check;
alter table public.member_notifications
    add constraint member_notifications_source_check check (
        (notification_type = 'request_milestone' and request_event_id is not null
            and worker_message_id is null and review_id is null and review_status is null and schedule_event_id is null)
        or (notification_type = 'worker_reply' and request_event_id is null
            and worker_message_id is not null and review_id is null and review_status is null and schedule_event_id is null)
        or (notification_type = 'photo_review_status' and request_event_id is null
            and worker_message_id is null and review_id is not null and review_status is not null and schedule_event_id is null)
        or (notification_type = 'recurring_schedule_update' and request_event_id is null
            and worker_message_id is null and review_id is null and review_status is null and schedule_event_id is not null)
    );

create unique index if not exists idx_member_notifications_schedule_event
    on public.member_notifications(schedule_event_id) where schedule_event_id is not null;

create or replace function public.notify_member_recurring_schedule_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.member_notifications(member_id, notification_type, schedule_event_id)
    select schedule.member_id, 'recurring_schedule_update', new.id
      from public.member_request_schedules schedule
     where schedule.id = new.schedule_id
    on conflict (schedule_event_id) where schedule_event_id is not null do nothing;
    return new;
end;
$$;

drop trigger if exists member_request_schedule_event_notification on public.member_request_schedule_events;
create trigger member_request_schedule_event_notification
    after insert on public.member_request_schedule_events
    for each row execute function public.notify_member_recurring_schedule_event();

revoke all on function public.notify_member_recurring_schedule_event() from public, anon, authenticated;
