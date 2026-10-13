-- Staff-only Operations inbox and notification preference foundation.
create table if not exists public.operations_worker_notifications (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references auth.users(id) on delete cascade,
    work_item_id uuid references public.operations_work_items(id) on delete cascade,
    notification_type text not null check (notification_type in ('assigned', 'reassigned')),
    title text not null check (length(btrim(title)) between 1 and 160),
    body text not null check (length(btrim(body)) between 1 and 500),
    href text not null default '/operations' check (href like '/operations%'),
    dedupe_key text not null unique,
    read_at timestamptz,
    dismissed_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_operations_worker_notifications_inbox
    on public.operations_worker_notifications(worker_id, created_at desc)
    where dismissed_at is null;

create table if not exists public.operations_worker_notification_preferences (
    worker_id uuid primary key references auth.users(id) on delete cascade,
    sound_enabled boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.operations_worker_notifications enable row level security;
alter table public.operations_worker_notification_preferences enable row level security;
revoke all on public.operations_worker_notifications, public.operations_worker_notification_preferences from public, anon, authenticated;
grant all on public.operations_worker_notifications, public.operations_worker_notification_preferences to service_role;

create or replace function public.notify_operations_worker_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_title text;
begin
    if new.assigned_worker_id is null or new.status in ('completed', 'cancelled') then
        return new;
    end if;
    if tg_op = 'UPDATE' and new.assigned_worker_id is not distinct from old.assigned_worker_id then
        return new;
    end if;

    v_title := case when tg_op = 'INSERT' or old.assigned_worker_id is null
        then 'Work assigned to you' else 'Work reassigned to you' end;
    insert into public.operations_worker_notifications(
        worker_id, work_item_id, notification_type, title, body, href, dedupe_key
    ) values (
        new.assigned_worker_id, new.id,
        case when tg_op = 'INSERT' or old.assigned_worker_id is null then 'assigned' else 'reassigned' end,
        v_title, new.summary, '/operations?workItem=' || new.id::text,
        'assignment:' || new.id::text || ':' || new.version::text || ':' || new.assigned_worker_id::text
    ) on conflict (dedupe_key) do nothing;
    return new;
end;
$$;
drop trigger if exists operations_worker_assignment_notification on public.operations_work_items;
create trigger operations_worker_assignment_notification
    after insert or update on public.operations_work_items
    for each row execute function public.notify_operations_worker_assignment();
revoke all on function public.notify_operations_worker_assignment() from public, anon, authenticated;
grant execute on function public.notify_operations_worker_assignment() to service_role;

comment on table public.operations_worker_notifications is
    'Private staff inbox. Initial event coverage: direct work assignment and reassignment.';
comment on table public.operations_worker_notification_preferences is
    'Per-worker Operations notification preferences, separate from member preferences.';
