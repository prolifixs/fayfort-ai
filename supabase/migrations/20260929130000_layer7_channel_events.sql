-- Layer 7 normalized inbound-event receipt and idempotency record.
-- Stores event metadata only; message content and provider credentials are not copied here.
create table if not exists public.channel_events (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    channel text not null,
    provider_event_id text not null,
    event_type text not null default 'inbound_message',
    status text not null default 'processing'
        check (status in ('processing', 'processed', 'failed')),
    conversation_id uuid references public.conversations(id) on delete set null,
    response_message_id uuid references public.messages(id) on delete set null,
    reason_code text,
    received_at timestamptz not null default now(),
    processed_at timestamptz,
    unique (business_id, channel, provider_event_id)
);

create index if not exists idx_channel_events_business_received
    on public.channel_events(business_id, received_at desc);
create index if not exists idx_channel_events_processing
    on public.channel_events(status, received_at)
    where status in ('processing', 'failed');

alter table public.channel_events enable row level security;
revoke all on table public.channel_events from anon, authenticated;
grant select, insert, update, delete on table public.channel_events to service_role;

comment on table public.channel_events is
    'Layer 7 normalized provider event receipt and idempotency metadata; excludes raw message bodies and provider secrets.';