-- Membership plan (docs/MEMBERSHIP_PLAN.md): sourcing deposits, consultations and supplier contact unlocks.
-- Prices and plan rules live in the API (app/membership/plans.py); the database keeps the records and
-- makes contact unlocks atomic.

-- ---------------------------------------------------------------------------------------------
-- 1. Invoice kinds. A sourcing request can have a deposit invoice and an order invoice; the order
--    invoice deducts a paid deposit (deposit_credit). Consultations and contact-credit packs are
--    invoices that belong to the member only.
-- ---------------------------------------------------------------------------------------------
alter table public.commerce_invoices
    add column if not exists kind text not null default 'order',
    add column if not exists deposit_credit numeric(14,2) not null default 0,
    add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.commerce_invoices
    drop constraint if exists commerce_invoices_kind_check,
    add constraint commerce_invoices_kind_check
        check (kind in ('order', 'deposit', 'consultation', 'contact_credits')),
    drop constraint if exists commerce_invoices_deposit_credit_check,
    add constraint commerce_invoices_deposit_credit_check check (deposit_credit >= 0),
    drop constraint if exists commerce_invoices_details_check,
    add constraint commerce_invoices_details_check check (jsonb_typeof(details) = 'object'),
    drop constraint if exists commerce_invoice_source,
    add constraint commerce_invoice_source check (
        (kind in ('order', 'deposit') and (request_id is not null or trend_item_id is not null))
        or (kind in ('consultation', 'contact_credits') and request_id is null and trend_item_id is null)
    );

drop index if exists public.uq_commerce_invoices_open_request;
create unique index if not exists uq_commerce_invoices_open_request_kind
    on public.commerce_invoices(request_id, kind)
    where request_id is not null and status in ('draft', 'sent', 'paid');

-- ---------------------------------------------------------------------------------------------
-- 2. The member's expected budget on a sourcing request (pre-fills the deposit).
-- ---------------------------------------------------------------------------------------------
alter table public.member_purchase_requests
    add column if not exists expected_total numeric(14,2),
    add column if not exists expected_currency text;
alter table public.member_purchase_requests
    drop constraint if exists member_purchase_requests_expected_total_check,
    add constraint member_purchase_requests_expected_total_check
        check (expected_total is null or expected_total > 0),
    drop constraint if exists member_purchase_requests_expected_currency_check,
    add constraint member_purchase_requests_expected_currency_check
        check (expected_currency is null or expected_currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------------------------
-- 3. Consultations.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.member_consultations (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    topic text not null check (length(btrim(topic)) between 3 and 1000),
    plan text not null check (plan in ('free', 'standard', 'pro')),
    price numeric(10,2) not null check (price >= 0),
    currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
    included boolean not null default false,
    status text not null default 'awaiting_payment'
        check (status in ('awaiting_payment', 'requested', 'scheduled', 'completed', 'cancelled')),
    invoice_id uuid references public.commerce_invoices(id) on delete set null,
    conversation_id uuid references public.member_conversations(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_member_consultations_member
    on public.member_consultations(member_id, created_at desc);
create unique index if not exists uq_member_consultations_invoice
    on public.member_consultations(invoice_id) where invoice_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 4. Supplier contact unlocks and credits.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.member_contact_unlocks (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    record_type text not null check (record_type in ('market', 'service_provider', 'hotel', 'restaurant')),
    record_id uuid not null,
    method text not null check (method in ('pro_allowance', 'credit', 'free')),
    created_at timestamptz not null default now(),
    unique (member_id, record_type, record_id)
);
create index if not exists idx_member_contact_unlocks_member
    on public.member_contact_unlocks(member_id, created_at desc);

create table if not exists public.member_contact_credits (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    delta integer not null check (delta <> 0),
    reason text not null check (reason in ('purchase', 'unlock', 'adjustment')),
    invoice_id uuid references public.commerce_invoices(id) on delete set null,
    unlock_id uuid references public.member_contact_unlocks(id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists idx_member_contact_credits_member on public.member_contact_credits(member_id);
create unique index if not exists uq_member_contact_credits_purchase
    on public.member_contact_credits(invoice_id) where reason = 'purchase';

-- Unlock one record for a member: free records (hotels, restaurants), then Pro's monthly allowance,
-- then a purchased credit. Serialised per member so two clicks can't spend the same credit.
create or replace function public.unlock_member_contact(
    p_member_id uuid,
    p_record_type text,
    p_record_id uuid,
    p_is_pro boolean,
    p_pro_monthly_limit integer
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
        if p_is_pro then
            select count(*) into v_used from public.member_contact_unlocks
             where member_id = p_member_id and method = 'pro_allowance'
               and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
            if v_used < p_pro_monthly_limit then v_method := 'pro_allowance'; end if;
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

-- ---------------------------------------------------------------------------------------------
-- 5. A paid invoice confirms the purchase on a request only for the order invoice; a paid deposit
--    leaves the request where it is.
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_commerce_invoice_paid(p_invoice_id uuid, p_shopify_order_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_invoice public.commerce_invoices%rowtype;
    v_stage text;
    v_sequence bigint;
begin
    select * into v_invoice from public.commerce_invoices where id = p_invoice_id for update;
    if not found then raise exception 'invoice not found'; end if;
    if v_invoice.status = 'paid' then return 'already_paid'; end if;
    update public.commerce_invoices
       set status = 'paid', paid_at = now(), shopify_order_id = coalesce(p_shopify_order_id, shopify_order_id), error = null
     where id = p_invoice_id;
    if v_invoice.request_id is null or v_invoice.kind <> 'order' then return 'paid'; end if;
    perform 1 from public.member_purchase_requests where id = v_invoice.request_id for update;
    select event.stage, event.sequence_no into v_stage, v_sequence
      from public.member_request_events event
     where event.request_id = v_invoice.request_id
     order by event.sequence_no desc limit 1;
    if v_stage in ('sourcing', 'options_sent') then
        insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id, details)
        values (v_invoice.request_id, coalesce(v_sequence, 0) + 1, 'purchase_confirmed',
                'Payment received through your FayFort invoice.', null, '{}'::jsonb);
        update public.member_purchase_requests set updated_at = now() where id = v_invoice.request_id;
        return 'paid_and_confirmed';
    end if;
    return 'paid';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Access: API only.
-- ---------------------------------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array['member_consultations', 'member_contact_unlocks', 'member_contact_credits'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on table public.%I from public, anon, authenticated', t);
        execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    end loop;
end;
$$;
revoke all on function public.unlock_member_contact(uuid, text, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.unlock_member_contact(uuid, text, uuid, boolean, integer) to service_role;
revoke all on function public.record_commerce_invoice_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.record_commerce_invoice_paid(uuid, text) to service_role;

comment on table public.member_consultations is
    'Consultation bookings: $100 Free, $50 Standard, Pro one included per month (then $50). Paid through a Shopify invoice.';
comment on table public.member_contact_unlocks is
    'Directory records whose private details a member has unlocked. Unlocked records stay visible for good.';
comment on table public.member_contact_credits is
    'Contact credit ledger: +N when a credit pack invoice is paid, -1 per paid unlock. Balance = sum(delta).';
