-- Member-owned saved catalog products. Member reads/writes flow through the
-- verified /members/products API; browser clients cannot access this table.
create table if not exists public.member_saved_products (
    member_id uuid not null references auth.users(id) on delete cascade,
    product_id uuid not null references public.directory_products(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (member_id, product_id)
);

create index if not exists idx_member_saved_products_member_created
    on public.member_saved_products (member_id, created_at desc);

alter table public.member_saved_products enable row level security;
revoke all on table public.member_saved_products from anon, authenticated;
grant select, insert, delete on table public.member_saved_products to service_role;

comment on table public.member_saved_products is
    'Member-specific saved products. Access is mediated by the verified FayFort member API; direct browser access is denied.';
