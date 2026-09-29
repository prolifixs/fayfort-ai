-- FayFort Layer 6: structured directory data and a closed-by-default access boundary.
-- Registry field rules live in app/directory/registry.py; subscription systems may
-- later populate business_tool_entitlements without changing those tool contracts.

create table if not exists public.directory_categories (
    source_ref text primary key,
    category_number integer,
    category text not null,
    group_name text,
    product_type text not null,
    priority text check (priority is null or priority in ('P1', 'P2', 'P3')),
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.directory_markets (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    place_name text,
    city text,
    district text,
    address_en text,
    address_cn text,
    buyer_notes text,
    verification_status text not null default 'unknown'
        check (verification_status in ('verified', 'unverified', 'unknown', 'conflicting')),
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (place_name is not null or address_en is not null or address_cn is not null)
);

create table if not exists public.directory_market_categories (
    market_id uuid not null references public.directory_markets(id) on delete cascade,
    category_ref text not null references public.directory_categories(source_ref) on delete cascade,
    source_key text not null unique,
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    primary key (market_id, category_ref)
);

create table if not exists public.directory_contacts (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    market_id uuid not null references public.directory_markets(id) on delete cascade,
    contact_name text,
    phone_wechat text,
    floor_or_stall text,
    best_time text,
    verification_status text not null default 'unknown'
        check (verification_status in ('verified', 'unverified', 'unknown', 'conflicting')),
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (contact_name is not null or phone_wechat is not null)
);

create table if not exists public.directory_service_providers (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    service text not null,
    company text,
    company_cn text,
    contact_name text,
    phone_wechat text,
    other_numbers text,
    email_qq text,
    city text,
    address_en text,
    address_cn text,
    booth text,
    ships_to text,
    hours text,
    verification_status text not null default 'unknown'
        check (verification_status in ('verified', 'unverified', 'unknown', 'conflicting')),
    notes text,
    source text,
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.directory_hotels (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    area text,
    hotel_name text not null,
    name_cn text,
    address_or_nearest_metro text,
    takes_foreigners boolean,
    rough_price_per_night text,
    tier text,
    notes text,
    phone text,
    verification_status text not null default 'unknown'
        check (verification_status in ('verified', 'unverified', 'unknown', 'conflicting')),
    source text,
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.directory_restaurants (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    area text,
    restaurant text not null,
    name_cn text,
    where_it_is text,
    food_type text,
    halal boolean,
    opening_hours text,
    notes text,
    phone text,
    verification_status text not null default 'unknown'
        check (verification_status in ('verified', 'unverified', 'unknown', 'conflicting')),
    source text,
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.directory_city_guides (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    city text not null,
    province text,
    known_for text,
    research_notes text,
    verification_status text not null default 'unknown'
        check (verification_status in ('verified', 'unverified', 'unknown', 'conflicting')),
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.directory_category_mappings (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    old_category text not null,
    entry_count integer,
    target_category_number integer,
    target_category_name text,
    notes text,
    mapping_status text not null default 'needs_review'
        check (mapping_status in ('suggested', 'confirmed', 'needs_review')),
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.directory_research_queue (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    issue_type text not null,
    source_payload jsonb not null default '{}'::jsonb
        check (jsonb_typeof(source_payload) = 'object'),
    status text not null default 'open'
        check (status in ('open', 'resolved', 'dismissed')),
    source_workbook text not null,
    source_sheet text not null,
    source_row integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Entitlement rows deliberately have no plan/tier dependency. A future billing
-- integration can create or revoke these rows after its commercial model exists.
create table if not exists public.business_tool_entitlements (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    tool_id text not null,
    access_level text not null check (access_level in ('registered', 'premium')),
    status text not null default 'active'
        check (status in ('active', 'inactive', 'revoked')),
    starts_at timestamptz not null default now(),
    expires_at timestamptz,
    entitlement_source text not null default 'manual',
    source_reference text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (business_id, tool_id, access_level),
    check (expires_at is null or expires_at > starts_at)
);

create table if not exists public.tool_access_events (
    id uuid primary key default gen_random_uuid(),
    business_id uuid references public.businesses(id) on delete set null,
    conversation_id uuid references public.conversations(id) on delete set null,
    customer_request_id uuid references public.customer_requests(id) on delete set null,
    tool_id text not null,
    outcome text not null check (outcome in (
        'ALLOW', 'UPGRADE_REQUIRED', 'AUTH_REQUIRED', 'VERIFY_REQUIRED',
        'HUMAN_REQUIRED', 'NOT_FOUND', 'DENIED'
    )),
    verification_state text check (verification_state is null or verification_state in (
        'verified', 'unverified', 'unknown', 'conflicting'
    )),
    returned_fields jsonb not null default '[]'::jsonb
        check (jsonb_typeof(returned_fields) = 'array'),
    reason_code text,
    created_at timestamptz not null default now()
);

create index if not exists idx_directory_categories_search
    on public.directory_categories using gin (
        to_tsvector('simple', coalesce(category, '') || ' ' || coalesce(group_name, '') || ' ' || coalesce(product_type, ''))
    );
create index if not exists idx_directory_markets_name
    on public.directory_markets using gin (to_tsvector('simple', coalesce(place_name, '') || ' ' || coalesce(city, '') || ' ' || coalesce(district, '')));
create index if not exists idx_directory_services_search
    on public.directory_service_providers using gin (to_tsvector('simple', coalesce(service, '') || ' ' || coalesce(city, '') || ' ' || coalesce(ships_to, '')));
create index if not exists idx_directory_hotels_search
    on public.directory_hotels using gin (to_tsvector('simple', coalesce(area, '') || ' ' || coalesce(hotel_name, '')));
create index if not exists idx_directory_restaurants_search
    on public.directory_restaurants using gin (to_tsvector('simple', coalesce(area, '') || ' ' || coalesce(restaurant, '') || ' ' || coalesce(food_type, '')));
create index if not exists idx_directory_city_guides_search
    on public.directory_city_guides using gin (to_tsvector('simple', coalesce(city, '') || ' ' || coalesce(province, '') || ' ' || coalesce(known_for, '')));
create index if not exists idx_business_tool_entitlements_lookup
    on public.business_tool_entitlements(business_id, tool_id, access_level, status);
create index if not exists idx_tool_access_events_business_created
    on public.tool_access_events(business_id, created_at desc);

create or replace function public.is_active_business_member(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.business_members bm
        where bm.business_id = target_business_id
          and bm.user_id = auth.uid()
          and bm.status = 'active'
    );
$$;

create or replace function public.set_directory_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare table_name text;
begin
    foreach table_name in array array[
        'directory_categories', 'directory_markets', 'directory_contacts',
        'directory_service_providers', 'directory_hotels', 'directory_restaurants',
        'directory_city_guides', 'directory_category_mappings',
        'directory_research_queue', 'business_tool_entitlements'
    ] loop
        execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
        execute format(
            'create trigger %I before update on public.%I for each row execute function public.set_directory_updated_at()',
            table_name || '_set_updated_at', table_name
        );
    end loop;
end;
$$;

alter table public.directory_categories enable row level security;
alter table public.directory_markets enable row level security;
alter table public.directory_market_categories enable row level security;
alter table public.directory_contacts enable row level security;
alter table public.directory_service_providers enable row level security;
alter table public.directory_hotels enable row level security;
alter table public.directory_restaurants enable row level security;
alter table public.directory_city_guides enable row level security;
alter table public.directory_category_mappings enable row level security;
alter table public.directory_research_queue enable row level security;
alter table public.business_tool_entitlements enable row level security;
alter table public.tool_access_events enable row level security;

-- Directory records and audit data are accessed through the server-side gateway.
-- Direct public/authenticated table access is denied; the gateway applies the
-- registry and entitlement rules before any fields reach the model or customer.
revoke all on table
    public.directory_categories,
    public.directory_markets,
    public.directory_market_categories,
    public.directory_contacts,
    public.directory_service_providers,
    public.directory_hotels,
    public.directory_restaurants,
    public.directory_city_guides,
    public.directory_category_mappings,
    public.directory_research_queue,
    public.business_tool_entitlements,
    public.tool_access_events
from anon, authenticated;

grant select, insert, update, delete on table
    public.directory_categories,
    public.directory_markets,
    public.directory_market_categories,
    public.directory_contacts,
    public.directory_service_providers,
    public.directory_hotels,
    public.directory_restaurants,
    public.directory_city_guides,
    public.directory_category_mappings,
    public.directory_research_queue,
    public.business_tool_entitlements,
    public.tool_access_events
to service_role;

create policy "business_members_can_view_own_tool_entitlements"
on public.business_tool_entitlements
for select to authenticated
using (public.is_active_business_member(business_id));
grant select on table public.business_tool_entitlements to authenticated;

comment on table public.directory_research_queue is
    'Private workbook curation items; never expose through customer lookup tools.';
comment on table public.tool_access_events is
    'Layer 6 access decisions. Stores policy outcomes and field names, not prompts or protected values.';
comment on table public.business_tool_entitlements is
    'Business-level access grants independent of any future subscription plan design.';
