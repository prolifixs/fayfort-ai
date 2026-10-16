-- Member addresses (up to two), a delivery address on each order invoice, and the first-visit tour.
--
-- * A member can save up to two shipping addresses; one is the default. Paying an order invoice from the
--   dashboard asks which one to use, and that address is stored on the invoice and sent to the Shopify draft
--   order so fulfillment ships to it.
-- * The old single address on member_profiles is copied in as the member's default address. Those profile
--   columns stay for now (read-only history) and are no longer written by the app.
-- * onboarding_completed_at records that the member finished or skipped the dashboard tour.

create table if not exists public.member_addresses (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    label text not null default 'Home' check (length(btrim(label)) between 1 and 40),
    recipient_name text check (recipient_name is null or length(recipient_name) <= 120),
    phone text check (
        phone is null
        or (phone ~ '^[+0-9(). -]+$' and length(regexp_replace(phone, '\D', '', 'g')) between 7 and 15)
    ),
    line1 text not null check (length(btrim(line1)) between 1 and 160),
    line2 text check (line2 is null or length(line2) <= 160),
    city text not null check (length(btrim(city)) between 1 and 100),
    region text check (region is null or length(region) <= 100),
    postal_code text check (postal_code is null or length(postal_code) <= 32),
    country text not null check (length(btrim(country)) between 1 and 100),
    is_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_member_addresses_member on public.member_addresses(member_id, created_at);
create unique index if not exists uq_member_addresses_one_default
    on public.member_addresses(member_id) where is_default;
alter table public.member_addresses enable row level security;
revoke all on public.member_addresses from anon, authenticated;

create or replace function public.enforce_member_address_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
    perform pg_advisory_xact_lock(hashtext('member_addresses:' || new.member_id::text));
    if (select count(*) from public.member_addresses where member_id = new.member_id) >= 2 then
        raise exception 'a member can save up to two addresses';
    end if;
    return new;
end;
$$;
drop trigger if exists member_addresses_limit on public.member_addresses;
create trigger member_addresses_limit
    before insert on public.member_addresses
    for each row execute function public.enforce_member_address_limit();

-- Carry the existing single profile address over as the default address.
insert into public.member_addresses(member_id, label, phone, line1, line2, city, region, postal_code, country, is_default)
select profile.user_id, 'Home', profile.shipping_phone, profile.shipping_address_line1, profile.shipping_address_line2,
       profile.shipping_city, profile.shipping_region, profile.shipping_postal_code, profile.shipping_country, true
  from public.member_profiles profile
 where nullif(btrim(profile.shipping_address_line1), '') is not null
   and nullif(btrim(profile.shipping_city), '') is not null
   and nullif(btrim(profile.shipping_country), '') is not null
   and not exists (select 1 from public.member_addresses address where address.member_id = profile.user_id);

-- The address chosen when the member paid (a copy, so later edits don't change a past order).
alter table public.commerce_invoices
    add column if not exists ship_to jsonb check (ship_to is null or jsonb_typeof(ship_to) = 'object'),
    add column if not exists ship_to_address_id uuid references public.member_addresses(id) on delete set null;

-- First-visit dashboard tour.
alter table public.member_profiles
    add column if not exists onboarding_completed_at timestamptz;
