-- Global FayFort product catalog. This is staff-managed metadata only; member
-- discovery, saved products, image matching, and supplier linkage are separate work.
create table if not exists public.directory_products (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(btrim(name)) between 1 and 160),
    category_ref text not null references public.directory_categories(source_ref) on update cascade on delete restrict,
    description text not null default '' check (length(description) <= 2000),
    availability_status text not null default 'sourcing'
        check (availability_status in ('available', 'sourcing', 'unavailable')),
    active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_directory_products_active_name
    on public.directory_products (active, name);
create index if not exists idx_directory_products_category
    on public.directory_products (category_ref);

drop trigger if exists directory_products_set_updated_at on public.directory_products;
create trigger directory_products_set_updated_at
    before update on public.directory_products
    for each row execute function public.set_directory_updated_at();

alter table public.directory_products enable row level security;
revoke all on table public.directory_products from anon, authenticated;
grant select, insert, update, delete on table public.directory_products to service_role;

comment on table public.directory_products is
    'Global FayFort product catalog, managed by platform administrators through the authenticated server API. Supplier links and member discovery are deferred.';
