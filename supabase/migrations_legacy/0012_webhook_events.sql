-- FayFort AI
-- Migration 0012: Webhook Events

create table if not exists public.webhook_events (
    id uuid primary key default gen_random_uuid(),

    social_account_id uuid
        references public.social_accounts(id)
        on delete set null,

    platform text not null,

    event_type text,

    external_event_id text,

    payload jsonb not null default '{}'::jsonb,

    status text not null default 'received',

    error_message text,

    received_at timestamptz not null default now(),

    processed_at timestamptz
);

create unique index if not exists idx_webhook_events_external_event
    on public.webhook_events(platform, external_event_id)
    where external_event_id is not null;

create index if not exists idx_webhook_events_social_account_id
    on public.webhook_events(social_account_id);

create index if not exists idx_webhook_events_platform
    on public.webhook_events(platform);

create index if not exists idx_webhook_events_event_type
    on public.webhook_events(event_type);

create index if not exists idx_webhook_events_status
    on public.webhook_events(status);

create index if not exists idx_webhook_events_received_at
    on public.webhook_events(received_at);