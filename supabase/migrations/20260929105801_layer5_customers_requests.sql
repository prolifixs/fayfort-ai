-- FayFort AI
-- Migration 0020: Structured customers and business requests

create table if not exists public.customers (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null
        references public.businesses(id) on delete cascade,
    channel text not null,
    external_customer_id text not null,
    profile jsonb not null default '{}'::jsonb
        check (jsonb_typeof(profile) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (business_id, channel, external_customer_id)
);

create table if not exists public.customer_requests (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null
        references public.customers(id) on delete cascade,
    conversation_id uuid not null
        references public.conversations(id) on delete cascade,
    related_request_id uuid
        references public.customer_requests(id) on delete set null,
    request_type text not null,
    status text not null default 'active'
        check (status in ('active', 'awaiting_customer', 'completed', 'cancelled', 'superseded')),
    details jsonb not null default '{}'::jsonb
        check (jsonb_typeof(details) = 'object'),
    required_information jsonb not null default '[]'::jsonb
        check (jsonb_typeof(required_information) = 'array'),
    missing_information jsonb not null default '[]'::jsonb
        check (jsonb_typeof(missing_information) = 'array'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.conversation_intents
    add column if not exists customer_id uuid
        references public.customers(id) on delete set null;
alter table public.conversation_intents
    add column if not exists customer_request_id uuid
        references public.customer_requests(id) on delete set null;

create index if not exists idx_customer_requests_customer_id
    on public.customer_requests(customer_id, created_at desc);
create index if not exists idx_customer_requests_conversation_id
    on public.customer_requests(conversation_id, created_at desc);
create index if not exists idx_customer_requests_related_request_id
    on public.customer_requests(related_request_id);
create index if not exists idx_customer_requests_open
    on public.customer_requests(conversation_id, created_at desc)
    where status in ('active', 'awaiting_customer');
create index if not exists idx_conversation_intents_customer_id
    on public.conversation_intents(customer_id);
create index if not exists idx_conversation_intents_customer_request_id
    on public.conversation_intents(customer_request_id);

create or replace function public.set_customer_state_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_customer_state_updated_at();

drop trigger if exists customer_requests_set_updated_at on public.customer_requests;
create trigger customer_requests_set_updated_at
before update on public.customer_requests
for each row execute function public.set_customer_state_updated_at();

alter table public.customers enable row level security;
alter table public.customer_requests enable row level security;

drop policy if exists "members_can_manage_customers" on public.customers;
create policy "members_can_manage_customers"
on public.customers
for all
using (public.is_business_member(business_id))
with check (public.is_business_member(business_id));

drop policy if exists "members_can_manage_customer_requests" on public.customer_requests;
create policy "members_can_manage_customer_requests"
on public.customer_requests
for all
using (
    exists (
        select 1
        from public.conversations c
        join public.customers cust on cust.id = customer_requests.customer_id
        where c.id = customer_requests.conversation_id
          and cust.business_id = c.business_id
          and public.is_business_member(c.business_id)
    )
)
with check (
    exists (
        select 1
        from public.conversations c
        join public.customers cust on cust.id = customer_requests.customer_id
        where c.id = customer_requests.conversation_id
          and cust.business_id = c.business_id
          and public.is_business_member(c.business_id)
    )
);
