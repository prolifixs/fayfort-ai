-- Auditable directory verification decisions made by an active business owner/admin.
create table if not exists public.directory_verification_reviews (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    reviewer_user_id uuid not null references auth.users(id) on delete restrict,
    source_table text not null check (source_table in (
        'directory_markets', 'directory_contacts', 'directory_service_providers',
        'directory_hotels', 'directory_restaurants', 'directory_city_guides'
    )),
    record_id uuid not null,
    tool_id text not null,
    previous_status text not null check (previous_status in ('verified', 'unverified', 'unknown', 'conflicting')),
    verification_status text not null check (verification_status in ('verified', 'unverified', 'unknown', 'conflicting')),
    reason text not null check (length(trim(reason)) between 8 and 500),
    created_at timestamptz not null default now()
);
create index if not exists idx_directory_verification_reviews_business_created
    on public.directory_verification_reviews(business_id, created_at desc);
alter table public.directory_verification_reviews enable row level security;
revoke all on table public.directory_verification_reviews from anon, authenticated;
grant select, insert on table public.directory_verification_reviews to service_role;
