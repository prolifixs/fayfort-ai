-- Member plans readjusted (owner decisions, 2026-10-25; docs/MEMBERSHIP_PLAN.md section 12).
-- Standard $5.99 and Pro $14.99 a month. Perks grow with loyalty (first paid month at the plan below), allowances
-- follow the member's paid month, a failed payment keeps the plan for 7 days, a pause starts at the end of the paid
-- month, disputes end the plan, and Stripe fees are recorded. Safe to run again.

-- 1. Subscription state the new rules need.
alter table public.member_subscriptions
    add column if not exists current_period_start timestamptz,
    add column if not exists past_due_since timestamptz,
    add column if not exists paused_from timestamptz,
    add column if not exists disputed_at timestamptz,
    add column if not exists notified jsonb not null default '{}'::jsonb;

comment on column public.member_subscriptions.past_due_since is
    'When the latest payment failed. The plan stays on for 7 days (BILLING_PAST_DUE_GRACE_DAYS), then the member is Free until paid.';
comment on column public.member_subscriptions.paused_from is
    'A pause starts here (the end of the paid month when it was asked for). Perks stay on until then.';
comment on column public.member_subscriptions.disputed_at is
    'An open or lost card dispute: the plan is off. Cleared when the dispute is won.';

-- 2. Payments: Stripe fee and money lost to disputes.
alter table public.member_subscription_payments
    add column if not exists fee numeric(12,2) not null default 0 check (fee >= 0),
    add column if not exists dispute_lost_amount numeric(12,2) not null default 0 check (dispute_lost_amount >= 0);

-- 3. Card disputes (chargebacks) on membership payments.
create table if not exists public.billing_disputes (
    stripe_dispute_id text primary key check (stripe_dispute_id ~ '^(dp|du)_'),
    stripe_charge_id text,
    stripe_invoice_id text,
    member_id uuid references auth.users(id) on delete set null,
    amount numeric(12,2) not null default 0,
    currency text not null default 'usd',
    reason text check (reason is null or length(reason) <= 80),
    status text not null check (length(status) between 1 and 40),
    evidence_due_by timestamptz,
    work_item_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_billing_disputes_member on public.billing_disputes(member_id);
alter table public.billing_disputes enable row level security;
revoke all on table public.billing_disputes from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_disputes to service_role;

-- 4. Contact unlocks: the plan allowance (Standard 1, Pro 3) counts from the start of the member's paid month,
--    not the calendar month. The method keeps its old name, 'pro_allowance', for every plan's allowance.
drop function if exists public.unlock_member_contact(uuid, text, uuid, boolean, integer);
create or replace function public.unlock_member_contact(
    p_member_id uuid,
    p_record_type text,
    p_record_id uuid,
    p_allowance integer,
    p_period_start timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing public.member_contact_unlocks%rowtype;
    v_method text;
    v_used integer;
    v_balance integer;
    v_unlock_id uuid;
begin
    perform pg_advisory_xact_lock(hashtextextended('contact-unlock:' || p_member_id::text, 0));
    select * into v_existing from public.member_contact_unlocks
     where member_id = p_member_id and record_type = p_record_type and record_id = p_record_id;
    if found then
        return jsonb_build_object('status', 'already_unlocked', 'method', v_existing.method, 'unlock_id', v_existing.id);
    end if;
    if p_record_type in ('hotel', 'restaurant') then
        v_method := 'free';
    else
        if coalesce(p_allowance, 0) > 0 and p_period_start is not null then
            select count(*) into v_used from public.member_contact_unlocks
             where member_id = p_member_id and method = 'pro_allowance' and created_at >= p_period_start;
            if v_used < p_allowance then v_method := 'pro_allowance'; end if;
        end if;
        if v_method is null then
            select coalesce(sum(delta), 0) into v_balance from public.member_contact_credits where member_id = p_member_id;
            if v_balance < 1 then raise exception 'no_contact_credits'; end if;
            v_method := 'credit';
        end if;
    end if;
    insert into public.member_contact_unlocks(member_id, record_type, record_id, method)
    values (p_member_id, p_record_type, p_record_id, v_method) returning id into v_unlock_id;
    if v_method = 'credit' then
        insert into public.member_contact_credits(member_id, delta, reason, unlock_id)
        values (p_member_id, -1, 'unlock', v_unlock_id);
    end if;
    return jsonb_build_object('status', 'unlocked', 'method', v_method, 'unlock_id', v_unlock_id);
end;
$$;
revoke all on function public.unlock_member_contact(uuid, text, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.unlock_member_contact(uuid, text, uuid, integer, timestamptz) to service_role;

-- 5. Revenue: lost disputes count as refunds; Stripe fees as a new last column.
create or replace view public.revenue_entries with (security_invoker = true) as
select
    'shopify:' || orders.id::text as id,
    'shopify'::text as source,
    case
        when orders.source = 'storefront' then 'shop'
        when invoices.kind = 'order' then 'sourcing'
        when invoices.kind = 'deposit' then 'deposits'
        when invoices.kind = 'consultation' then 'consultations'
        when invoices.kind = 'contact_credits' then 'contact_credits'
        else 'other'
    end as stream,
    coalesce(orders.placed_at, orders.created_at) as occurred_at,
    coalesce(orders.total, 0)::numeric(14,2) as gross,
    least(coalesce(orders.refunded_amount, 0), coalesce(orders.total, 0))::numeric(14,2) as refunded,
    upper(coalesce(orders.currency, 'USD')) as currency,
    orders.member_id,
    orders.ship_country as country,
    orders.order_name as reference,
    orders.line_items,
    0::numeric(14,2) as fees
from public.commerce_orders orders
left join public.commerce_invoices invoices on invoices.id = orders.invoice_id
where orders.financial_status in ('paid', 'partially_paid', 'partially_refunded', 'refunded')
union all
select
    'stripe:' || payments.stripe_invoice_id,
    'stripe',
    'memberships',
    payments.paid_at,
    payments.amount::numeric(14,2),
    least(payments.refunded_amount + payments.dispute_lost_amount, payments.amount)::numeric(14,2),
    upper(payments.currency),
    payments.member_id,
    null,
    initcap(payments.plan) || ' plan',
    '[]'::jsonb,
    payments.fee::numeric(14,2)
from public.member_subscription_payments payments;

revoke all on table public.revenue_entries from public, anon, authenticated;
grant select on table public.revenue_entries to service_role;
