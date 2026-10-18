-- Store sections (docs/CATALOG_MERCHANDISING_PLAN.md §4): themed tiles on Browse, AliExpress style, that the
-- Store team builds and changes on a schedule. A section holds 3 to 12 live products, a hook ("3 from $0.99"),
-- a start and an optional end. The API hides a section with fewer live products than its minimum and opens a
-- "Refresh a store section" task.

create table if not exists public.merch_sections (
    id uuid primary key default gen_random_uuid(),
    title text not null check (length(btrim(title)) between 1 and 60),
    hook text not null default '' check (length(hook) <= 40),
    style text not null default 'deal' check (style in ('deal', 'trend', 'category')),
    accent text not null default 'pink' check (accent in ('pink', 'navy', 'gold', 'green', 'purple')),
    category_ref text references public.directory_categories(source_ref) on update cascade on delete set null,
    starts_at timestamptz not null default now(),
    ends_at timestamptz,
    priority integer not null default 100 check (priority between 0 and 1000),
    min_items integer not null default 3 check (min_items between 1 and 12),
    status text not null default 'published' check (status in ('draft', 'published', 'archived')),
    refresh_round integer not null default 0 check (refresh_round >= 0),
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint merch_sections_window check (ends_at is null or ends_at > starts_at)
);
create index if not exists idx_merch_sections_live on public.merch_sections(status, starts_at, ends_at);

create table if not exists public.merch_section_items (
    section_id uuid not null references public.merch_sections(id) on delete cascade,
    product_id uuid not null references public.directory_products(id) on delete cascade,
    position integer not null default 0 check (position between 0 and 100),
    primary key (section_id, product_id)
);
create index if not exists idx_merch_section_items_product on public.merch_section_items(product_id);

alter table public.merch_sections enable row level security;
alter table public.merch_section_items enable row level security;
revoke all on table public.merch_sections, public.merch_section_items from public, anon, authenticated;
grant select, insert, update, delete on table public.merch_sections, public.merch_section_items to service_role;

comment on table public.merch_sections is
    'Store sections shown on member Browse: title, hook, style, dates and 3 to 12 products. Service role only.';
