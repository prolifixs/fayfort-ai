-- FayFort email system: per-category switches, member email preferences, an outbox fed by
-- member_notifications, simple newsletters, and an append-only audit of admin email actions.
-- Delivery happens in the API's background sender (Resend); nothing here talks to the network.

create table if not exists public.email_category_settings (
    category text primary key check (category in (
        'conversations', 'fulfillment', 'notifications', 'newsletter', 'account_security'
    )),
    enabled boolean not null default true,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);
insert into public.email_category_settings(category) values
    ('conversations'), ('fulfillment'), ('notifications'), ('newsletter'), ('account_security')
on conflict (category) do nothing;

create table if not exists public.member_email_preferences (
    member_id uuid primary key references auth.users(id) on delete cascade,
    conversations boolean not null default true,
    fulfillment boolean not null default true,
    notifications boolean not null default true,
    newsletter boolean not null default true,
    unsubscribe_token uuid not null unique default gen_random_uuid(),
    updated_at timestamptz not null default now()
);

create table if not exists public.newsletters (
    id uuid primary key default gen_random_uuid(),
    subject text not null check (length(btrim(subject)) between 1 and 150),
    body_text text not null check (length(btrim(body_text)) between 1 and 20000),
    status text not null default 'draft' check (status in ('draft', 'sending', 'sent')),
    recipient_count integer not null default 0 check (recipient_count >= 0),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_by uuid references auth.users(id) on delete set null,
    sent_at timestamptz,
    constraint newsletters_sent_state check ((status = 'draft') = (sent_at is null))
);

create table if not exists public.email_outbox (
    id uuid primary key default gen_random_uuid(),
    category text not null check (category in (
        'conversations', 'fulfillment', 'notifications', 'newsletter', 'account_security'
    )),
    template text not null check (length(template) between 1 and 60),
    member_id uuid references auth.users(id) on delete cascade,
    to_email text check (to_email is null or length(to_email) <= 320),
    notification_id uuid unique references public.member_notifications(id) on delete set null,
    newsletter_id uuid references public.newsletters(id) on delete cascade,
    payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
    status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
    skip_reason text check (skip_reason is null or length(skip_reason) <= 120),
    subject text check (subject is null or length(subject) <= 200),
    attempts integer not null default 0 check (attempts between 0 and 20),
    last_error text check (last_error is null or length(last_error) <= 500),
    provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
    next_attempt_at timestamptz not null default now(),
    claimed_at timestamptz,
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    constraint email_outbox_recipient check (member_id is not null or to_email is not null),
    constraint email_outbox_newsletter_once unique (newsletter_id, member_id)
);
create index if not exists idx_email_outbox_due on public.email_outbox(next_attempt_at) where status = 'queued';
create index if not exists idx_email_outbox_created on public.email_outbox(created_at desc);
create index if not exists idx_email_outbox_member_category on public.email_outbox(member_id, category, created_at desc);

create table if not exists public.email_admin_audit (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references auth.users(id) on delete set null,
    action text not null check (action in (
        'category_enabled', 'category_disabled', 'newsletter_saved', 'newsletter_test_sent',
        'newsletter_sent', 'email_retried'
    )),
    detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
    created_at timestamptz not null default now()
);
create index if not exists idx_email_admin_audit_created on public.email_admin_audit(created_at desc);

create or replace function public.prevent_email_admin_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'email_admin_audit is append-only';
end;
$$;
drop trigger if exists email_admin_audit_append_only on public.email_admin_audit;
create trigger email_admin_audit_append_only
    before update or delete on public.email_admin_audit
    for each row execute function public.prevent_email_admin_audit_mutation();

-- Only the API's service role reads or writes these tables.
alter table public.email_category_settings enable row level security;
alter table public.member_email_preferences enable row level security;
alter table public.newsletters enable row level security;
alter table public.email_outbox enable row level security;
alter table public.email_admin_audit enable row level security;
revoke all on table public.email_category_settings, public.member_email_preferences, public.newsletters,
    public.email_outbox, public.email_admin_audit from public, anon, authenticated;
grant select, insert, update on table public.email_category_settings, public.member_email_preferences,
    public.newsletters, public.email_outbox to service_role;
grant select, insert on table public.email_admin_audit to service_role;
revoke all on function public.prevent_email_admin_audit_mutation() from public, anon, authenticated;

-- Every member alert becomes a queued email; the sender decides at delivery time whether the
-- category is on, the member wants it, and whether a conversation email should be coalesced.
create or replace function public.enqueue_member_notification_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_category text;
begin
    v_category := case new.notification_type
        when 'worker_reply' then 'conversations'
        when 'request_milestone' then 'fulfillment'
        else 'notifications' end;
    insert into public.email_outbox(category, template, member_id, notification_id)
    values (v_category, new.notification_type, new.member_id, new.id)
    on conflict (notification_id) do nothing;
    return new;
end;
$$;
revoke all on function public.enqueue_member_notification_email() from public, anon, authenticated;

drop trigger if exists member_notification_email on public.member_notifications;
create trigger member_notification_email
    after insert on public.member_notifications
    for each row execute function public.enqueue_member_notification_email();

-- Claim a batch of due emails for one sender cycle (skip locked rows so two senders never collide).
create or replace function public.claim_email_outbox(p_limit integer default 20)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
    return query
    update public.email_outbox outbox
       set status = 'sending', attempts = outbox.attempts + 1, claimed_at = now()
     where outbox.id in (
        select id from public.email_outbox
         where status = 'queued' and next_attempt_at <= now()
         order by next_attempt_at, created_at
         limit greatest(1, least(coalesce(p_limit, 20), 100))
         for update skip locked)
    returning outbox.*;
end;
$$;
revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;

-- Emails stuck in "sending" (for example after a restart mid-send) go back to the queue.
create or replace function public.requeue_stale_email_outbox(p_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    update public.email_outbox
       set status = 'queued', next_attempt_at = now()
     where status = 'sending'
       and claimed_at < now() - make_interval(mins => greatest(1, p_minutes))
       and attempts < 5;
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;
revoke all on function public.requeue_stale_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.requeue_stale_email_outbox(integer) to service_role;

comment on table public.email_outbox is
    'FayFort-sent email queue and delivery log (Resend). Fed by member_notifications, newsletters and staff security emails.';
comment on table public.member_email_preferences is
    'Per-member email category choices and the unsubscribe token used by one-click unsubscribe links.';
