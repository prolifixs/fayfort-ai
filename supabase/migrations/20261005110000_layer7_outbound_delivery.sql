-- Instagram outbound delivery receipts and connection association for conversations.
-- Message bodies and provider credentials remain in their existing protected stores.
alter table public.conversations
    add column if not exists business_connection_id uuid
        references public.business_connections(id) on delete set null;

create index if not exists idx_conversations_business_connection
    on public.conversations(business_connection_id, created_at desc)
    where business_connection_id is not null;

with single_instagram_connection as (
    select business_id, min(id::text)::uuid as connection_id
    from public.business_connections
    where provider = 'instagram' and status = 'connected'
    group by business_id
    having count(*) = 1
)
update public.conversations as conversation
set business_connection_id = connection.connection_id
from single_instagram_connection as connection
where conversation.business_id = connection.business_id
  and lower(conversation.channel) = 'instagram'
  and conversation.business_connection_id is null;

alter table public.messages
    add column if not exists agent_id uuid references auth.users(id) on delete set null;

create table if not exists public.channel_deliveries (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    connection_id uuid not null references public.business_connections(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    message_id uuid not null unique references public.messages(id) on delete cascade,
    channel text not null,
    status text not null check (status in ('sending', 'sent', 'rejected', 'unknown')),
    attempt_count integer not null default 0 check (attempt_count >= 0),
    provider_message_id text,
    safe_error_code text,
    last_attempt_at timestamptz,
    delivered_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_channel_deliveries_business_created
    on public.channel_deliveries(business_id, created_at desc);
create index if not exists idx_channel_deliveries_conversation
    on public.channel_deliveries(conversation_id, created_at desc);

create table if not exists public.channel_delivery_attempts (
    id uuid primary key default gen_random_uuid(),
    delivery_id uuid not null references public.channel_deliveries(id) on delete cascade,
    attempt_number integer not null check (attempt_number > 0),
    status text not null check (status in ('sending', 'sent', 'rejected', 'unknown')),
    provider_message_id text,
    safe_error_code text,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    unique (delivery_id, attempt_number)
);

alter table public.channel_deliveries enable row level security;
alter table public.channel_delivery_attempts enable row level security;
revoke all on table public.channel_deliveries, public.channel_delivery_attempts from anon, authenticated;
grant select, insert, update, delete on table public.channel_deliveries, public.channel_delivery_attempts to service_role;

comment on table public.channel_deliveries is
    'Per-message outbound delivery state. Unknown outcomes are not automatically retried to avoid duplicate customer messages.';
comment on table public.channel_delivery_attempts is
    'Metadata-only history of provider send attempts; excludes message content and access tokens.';
