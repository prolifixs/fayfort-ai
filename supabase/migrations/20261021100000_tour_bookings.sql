-- Tour guide bookings (owner request, 2026-10-20): a FayFort team member meets the member in China.
-- First version: the member requests, staff quote with a Shopify invoice, payment confirms, staff assign a guide.
-- Pending completion: a live calendar and team availability (shared with consultations).
create table if not exists public.member_tour_bookings (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    city text not null check (city in ('guangzhou', 'yiwu', 'shenzhen', 'shanghai', 'other')),
    city_other text check (city_other is null or length(city_other) <= 80),
    arrival_date date not null,
    days integer not null check (days between 1 and 30),
    people integer not null check (people between 1 and 50),
    needs text[] not null default '{}',
    hotel_area text check (hotel_area is null or length(hotel_area) <= 200),
    whatsapp text check (whatsapp is null or length(whatsapp) <= 40),
    notes text check (notes is null or length(notes) <= 2000),
    status text not null default 'requested'
        check (status in ('requested', 'quoted', 'confirmed', 'completed', 'cancelled')),
    quote_amount numeric(12,2) check (quote_amount is null or quote_amount > 0),
    currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
    invoice_id uuid references public.commerce_invoices(id) on delete set null,
    conversation_id uuid references public.member_conversations(id) on delete set null,
    work_item_id uuid,
    guide_worker_id uuid references auth.users(id) on delete set null,
    guide_name text check (guide_name is null or length(guide_name) <= 80),
    cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_member_tour_bookings_member on public.member_tour_bookings(member_id, created_at desc);
create index if not exists idx_member_tour_bookings_status on public.member_tour_bookings(status, arrival_date);
create unique index if not exists uq_member_tour_bookings_invoice on public.member_tour_bookings(invoice_id) where invoice_id is not null;

alter table public.member_tour_bookings enable row level security;
revoke all on table public.member_tour_bookings from public, anon, authenticated;

-- Tour quotes are Shopify invoices like consultations.
alter table public.commerce_invoices
    drop constraint if exists commerce_invoices_kind_check,
    add constraint commerce_invoices_kind_check
        check (kind in ('order', 'deposit', 'consultation', 'contact_credits', 'tour')),
    drop constraint if exists commerce_invoice_source,
    add constraint commerce_invoice_source check (
        (kind in ('order', 'deposit') and (request_id is not null or trend_item_id is not null))
        or (kind in ('consultation', 'contact_credits', 'tour') and request_id is null and trend_item_id is null)
    );
grant select, insert, update, delete on table public.member_tour_bookings to service_role;
