-- Member plan billing through Stripe (docs/MEMBERSHIP_PLAN.md). Stripe is the source of truth; the API mirrors each
-- member's subscription here and sets member_profiles.member_tier from it.

create table if not exists public.member_subscriptions (
    member_id uuid primary key references auth.users(id) on delete cascade,
    stripe_customer_id text unique check (stripe_customer_id is null or stripe_customer_id ~ '^cus_'),
    stripe_subscription_id text unique check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_'),
    plan text check (plan is null or plan in ('standard', 'pro')),
    status text not null default 'none' check (status in (
        'none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
    )),
    current_period_end timestamptz,
    cancel_at_period_end boolean not null default false,
    -- Start of the member's continuous subscription. Kept when they come back within the return grace period.
    continuous_since timestamptz,
    ended_at timestamptz,
    updated_at timestamptz not null default now()
);

-- One row per paid Stripe subscription invoice: counts toward rank (continuous months subscribed).
create table if not exists public.member_subscription_payments (
    stripe_invoice_id text primary key check (stripe_invoice_id ~ '^in_'),
    member_id uuid not null references auth.users(id) on delete cascade,
    plan text not null check (plan in ('standard', 'pro')),
    amount numeric(12,2) not null default 0,
    currency text not null default 'usd',
    paid_at timestamptz not null,
    created_at timestamptz not null default now()
);
create index if not exists idx_member_subscription_payments_member
    on public.member_subscription_payments(member_id, paid_at desc);

-- Stripe objects FayFort created (products, prices, portal configuration, webhook endpoint) and the webhook
-- signing secret Stripe returned when the endpoint was created. Service role only.
create table if not exists public.billing_settings (
    key text primary key check (length(key) between 1 and 80),
    value text not null check (length(value) <= 2000),
    updated_at timestamptz not null default now()
);

create table if not exists public.billing_webhook_events (
    stripe_event_id text primary key check (stripe_event_id ~ '^evt_'),
    event_type text not null,
    status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
    error text check (error is null or length(error) <= 500),
    received_at timestamptz not null default now()
);

alter table public.member_activity_events
    drop constraint if exists member_activity_events_kind_check,
    add constraint member_activity_events_kind_check check (kind in (
        'order', 'sourcing_purchase', 'deposit', 'pool', 'share_buyer', 'consultation', 'giveaway_entry',
        'subscription', 'redeem'
    ));

do $$
declare
    t text;
begin
    foreach t in array array['member_subscriptions', 'member_subscription_payments', 'billing_settings',
                             'billing_webhook_events'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on table public.%I from public, anon, authenticated', t);
        execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    end loop;
end;
$$;

comment on table public.member_subscriptions is
    'Mirror of each member''s Stripe subscription. member_profiles.member_tier follows it (active/trialing/past_due = plan).';
comment on table public.billing_settings is
    'Stripe objects FayFort set up (product/price/portal/webhook ids) and the webhook signing secret. Service role only.';
