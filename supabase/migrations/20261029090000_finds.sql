-- FayFort Finds (docs/FINDS_PLAN.md): trending products and rare finds, researched and checked in China, released in
-- weekly drops. Owner decisions 2026-10-26: inside Standard and Pro; Monday drops of about 10 (7 trending, 3 rare);
-- landed estimates for any country; rare finds for every paid member; the Store team handles finds.
-- Safe to run again.

-- 1. Weekly drops. Pro sees a drop at early_at (48 h before), Standard at release_at, everyone in the regular catalog
--    from catalog_at (a week later).
create table if not exists public.find_drops (
    id uuid primary key default gen_random_uuid(),
    title text not null check (length(btrim(title)) between 1 and 120),
    early_at timestamptz not null,
    release_at timestamptz not null unique,
    catalog_at timestamptz not null,
    target_count smallint not null default 10 check (target_count between 1 and 50),
    note text check (note is null or length(note) <= 500),
    notified jsonb not null default '{}'::jsonb,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint find_drops_order check (early_at <= release_at and release_at <= catalog_at)
);

-- 2. A find: a sourcing listing (and, once published, its product) plus the research behind it.
create table if not exists public.finds (
    id uuid primary key default gen_random_uuid(),
    listing_id uuid unique references public.store_listings(id) on delete set null,
    product_id uuid unique references public.directory_products(id) on delete set null,
    drop_id uuid references public.find_drops(id) on delete set null,
    status text not null default 'scouted'
        check (status in ('scouted', 'checked', 'not_obtainable', 'in_review', 'scheduled', 'released', 'retired')),
    lane text not null check (lane in ('trending', 'rare')),
    stage text check (stage is null or stage in ('rising', 'peaking', 'steady')),
    competition text check (competition is null or competition in ('low', 'medium', 'high')),
    signal_platforms text[] not null default '{}' check (cardinality(signal_platforms) <= 10),
    signal_regions text[] not null default '{}' check (cardinality(signal_regions) <= 10),
    why text check (why is null or length(why) <= 600),
    scout_note text check (scout_note is null or length(scout_note) <= 2000),
    scouted_by uuid references auth.users(id) on delete set null,
    scouted_at timestamptz not null default now(),
    china_check text check (china_check is null or china_check in ('in_person', 'supplier', 'online')),
    china_place text check (china_place is null or length(china_place) <= 120),
    unit_cost_min numeric(14,2) check (unit_cost_min is null or unit_cost_min >= 0),
    unit_cost_max numeric(14,2) check (unit_cost_max is null or unit_cost_max >= 0),
    cost_currency text not null default 'CNY' check (cost_currency ~ '^[A-Z]{3}$'),
    supplier_moq integer check (supplier_moq is null or supplier_moq between 1 and 1000000),
    sample_available boolean,
    china_note text check (china_note is null or length(china_note) <= 2000),
    checked_by uuid references auth.users(id) on delete set null,
    checked_at timestamptz,
    sell_price_min numeric(14,2) check (sell_price_min is null or sell_price_min > 0),
    sell_price_max numeric(14,2) check (sell_price_max is null or sell_price_max > 0),
    price_breaks jsonb not null default '[]'::jsonb
        check (jsonb_typeof(price_breaks) = 'array' and jsonb_array_length(price_breaks) <= 6),
    unit_weight_kg numeric(8,3) check (unit_weight_kg is null or unit_weight_kg > 0),
    approved_by uuid references auth.users(id) on delete set null,
    approved_at timestamptz,
    released_at timestamptz,
    last_alert jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_finds_status on public.finds(status, updated_at desc);
create index if not exists idx_finds_drop on public.finds(drop_id) where drop_id is not null;

-- 3. Shipping rates for landed-cost estimates, per zone (any country maps to a zone in app/finds/shipping.py).
create table if not exists public.find_shipping_rates (
    zone text primary key check (zone ~ '^[a-z_]{2,40}$'),
    label text not null check (length(label) <= 80),
    air_per_kg numeric(10,2) check (air_per_kg is null or air_per_kg >= 0),
    handling_per_unit numeric(10,2) not null default 0 check (handling_per_unit >= 0),
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);
insert into public.find_shipping_rates (zone, label) values
    ('west_africa', 'West Africa'), ('rest_of_africa', 'Rest of Africa'), ('uk_europe', 'UK and Europe'),
    ('north_america', 'USA and Canada'), ('middle_east', 'Middle East'), ('asia_pacific', 'Asia and Pacific'),
    ('latin_america', 'Latin America and Caribbean')
on conflict (zone) do nothing;

-- 4. Members watching a find (alerts on price, availability and new drops depend on the plan).
create table if not exists public.member_find_watches (
    member_id uuid not null references auth.users(id) on delete cascade,
    find_id uuid not null references public.finds(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (member_id, find_id)
);
create index if not exists idx_member_find_watches_find on public.member_find_watches(find_id);

-- 5. Access: the API (service role) only.
alter table public.find_drops enable row level security;
alter table public.finds enable row level security;
alter table public.find_shipping_rates enable row level security;
alter table public.member_find_watches enable row level security;
revoke all on table public.find_drops, public.finds, public.find_shipping_rates, public.member_find_watches
    from public, anon, authenticated;
grant select, insert, update, delete on table public.find_drops, public.finds, public.find_shipping_rates,
    public.member_find_watches to service_role;

comment on table public.finds is
    'FayFort Finds: a sourcing listing or product plus its research (signal, China check, reseller pricing). Service role only.';
comment on table public.find_drops is
    'Weekly Finds drops: Pro at early_at, Standard at release_at, the regular catalog at catalog_at.';
