-- LANDED owners (owner request, 2026-10-25): the Baserow tables that came with LANDED close on 30 November 2026 and
-- the live directory moves to FayFort. People who bought LANDED see the addresses of every market and service provider
-- that was in the directory on 25 October 2026 (the snapshot), free. Supplier contacts and anything added later stay
-- behind contact credits. Buyers come from Shopify orders of the LANDED product. Safe to run again.

create table if not exists public.landed_owners (
    id uuid primary key default gen_random_uuid(),
    email text not null check (email = lower(email) and length(email) between 3 and 320),
    shopify_order_id text unique,
    order_name text check (order_name is null or length(order_name) <= 60),
    purchased_at timestamptz,
    source text not null default 'shopify' check (source in ('shopify', 'shopify_webhook', 'manual')),
    status text not null default 'active' check (status in ('active', 'refunded')),
    member_id uuid references auth.users(id) on delete set null,
    linked_at timestamptz,
    linked_by text check (linked_by is null or linked_by in ('email', 'claim')),
    notice_sent_at timestamptz,
    reminder_sent_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_landed_owners_email on public.landed_owners(email);
create index if not exists idx_landed_owners_member on public.landed_owners(member_id) where member_id is not null;

alter table public.landed_owners enable row level security;
revoke all on table public.landed_owners from public, anon, authenticated;
grant select, insert, update, delete on table public.landed_owners to service_role;

-- The snapshot: the records a LANDED owner sees addresses for. Keyed by source_key so updates from the Baserow sync
-- keep their place; records added after the snapshot are not in it.
create table if not exists public.landed_snapshot (
    record_type text not null check (record_type in ('market', 'service_provider')),
    source_key text not null,
    primary key (record_type, source_key)
);
alter table public.landed_snapshot enable row level security;
revoke all on table public.landed_snapshot from public, anon, authenticated;
grant select, insert, update, delete on table public.landed_snapshot to service_role;

insert into public.landed_snapshot (record_type, source_key)
select 'market', source_key from public.directory_markets where created_at < '2026-10-26 07:00:00+00'
on conflict do nothing;
insert into public.landed_snapshot (record_type, source_key)
select 'service_provider', source_key from public.directory_service_providers where created_at < '2026-10-26 07:00:00+00'
on conflict do nothing;
