-- Products and commerce plan (docs/PRODUCT_COMMERCE_PLAN.md, gates P1-P8).
-- Shopify is the commerce engine (products, prices, discounts, checkout, orders). FayFort keeps a
-- read copy of the catalog in directory_products plus everything that makes FayFort different:
-- Find It trend links, intent events, pools, flash-sale schedule, giveaways and the orders timeline.
-- Only the API (service_role) reads or writes these tables.

-- ---------------------------------------------------------------------------------------------
-- Catalog: Shopify products live in directory_products next to FayFort-only sourcing listings.
-- ---------------------------------------------------------------------------------------------
alter table public.directory_products alter column category_ref drop not null;

alter table public.directory_products
    add column if not exists source text not null default 'fayfort',
    add column if not exists shopify_product_id text,
    add column if not exists shopify_handle text,
    add column if not exists shopify_status text,
    add column if not exists vendor text,
    add column if not exists product_type text,
    add column if not exists tags text[] not null default '{}',
    add column if not exists price_min numeric(14,2),
    add column if not exists price_max numeric(14,2),
    add column if not exists compare_at_max numeric(14,2),
    add column if not exists currency text,
    add column if not exists in_stock boolean,
    add column if not exists total_inventory integer,
    add column if not exists restocked_at timestamptz,
    add column if not exists online_store_url text,
    add column if not exists shopify_updated_at timestamptz,
    add column if not exists synced_at timestamptz,
    add column if not exists category_needs_mapping boolean not null default false;

alter table public.directory_products
    drop constraint if exists directory_products_source_check,
    drop constraint if exists directory_products_source_fields_check,
    drop constraint if exists directory_products_currency_check;
alter table public.directory_products
    add constraint directory_products_source_check check (source in ('fayfort', 'shopify')),
    add constraint directory_products_source_fields_check check (
        (source = 'shopify' and shopify_product_id is not null)
        or (source = 'fayfort' and shopify_product_id is null and category_ref is not null)
    ),
    add constraint directory_products_currency_check check (currency is null or currency ~ '^[A-Z]{3}$');

create unique index if not exists uq_directory_products_shopify_id
    on public.directory_products (shopify_product_id) where shopify_product_id is not null;
create index if not exists idx_directory_products_source_active
    on public.directory_products (source, active);
create index if not exists idx_directory_products_needs_mapping
    on public.directory_products (category_needs_mapping) where category_needs_mapping;

create table if not exists public.commerce_variants (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.directory_products(id) on delete cascade,
    shopify_variant_id text not null unique,
    title text not null default '' check (length(title) <= 255),
    sku text check (sku is null or length(sku) <= 255),
    price numeric(14,2) not null check (price >= 0),
    compare_at_price numeric(14,2) check (compare_at_price is null or compare_at_price >= 0),
    available boolean not null default false,
    inventory_quantity integer,
    options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
    position integer not null default 1,
    image_url text check (image_url is null or image_url ~ '^https://'),
    updated_at timestamptz not null default now()
);
create index if not exists idx_commerce_variants_product on public.commerce_variants(product_id, position);

create table if not exists public.commerce_media (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.directory_products(id) on delete cascade,
    position integer not null check (position >= 0),
    media_type text not null check (media_type in ('image', 'video')),
    url text not null check (url ~ '^https://'),
    preview_url text check (preview_url is null or preview_url ~ '^https://'),
    alt text check (alt is null or length(alt) <= 512),
    unique (product_id, position)
);

create table if not exists public.commerce_sync_runs (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('webhook', 'reconcile', 'manual')),
    status text not null default 'running' check (status in ('running', 'ok', 'failed')),
    products_seen integer not null default 0,
    products_upserted integer not null default 0,
    products_removed integer not null default 0,
    error text check (error is null or length(error) <= 500),
    started_at timestamptz not null default now(),
    finished_at timestamptz
);
create index if not exists idx_commerce_sync_runs_started on public.commerce_sync_runs(started_at desc);

create table if not exists public.commerce_webhook_events (
    webhook_id text primary key check (length(webhook_id) between 1 and 200),
    topic text not null check (length(topic) <= 100),
    status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
    error text check (error is null or length(error) <= 500),
    received_at timestamptz not null default now(),
    processed_at timestamptz
);
create index if not exists idx_commerce_webhook_events_received on public.commerce_webhook_events(received_at desc);

-- ---------------------------------------------------------------------------------------------
-- Cart and checkout (P2). The cart lives in FayFort so impulse slots can read it; checkout hands
-- the lines to a Shopify Storefront cart and the member pays on Shopify's checkout.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.commerce_cart_lines (
    member_id uuid not null references auth.users(id) on delete cascade,
    variant_id uuid not null references public.commerce_variants(id) on delete cascade,
    quantity integer not null check (quantity between 1 and 99),
    added_at timestamptz not null default now(),
    primary key (member_id, variant_id)
);

create table if not exists public.commerce_checkouts (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    shopify_cart_id text not null,
    checkout_url text not null check (checkout_url ~ '^https://'),
    line_count integer not null check (line_count >= 1),
    subtotal numeric(14,2),
    currency text,
    created_at timestamptz not null default now()
);
create index if not exists idx_commerce_checkouts_member on public.commerce_checkouts(member_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Intent (P4): what members do, used for the session intent and FayFort-wide Heat.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.commerce_intent_events (
    id bigint generated always as identity primary key,
    member_id uuid not null references auth.users(id) on delete cascade,
    session_id text not null check (length(session_id) between 1 and 64),
    event_type text not null check (event_type in (
        'view', 'add_to_cart', 'search', 'category', 'paste_link', 'save', 'want', 'checkout'
    )),
    product_id uuid references public.directory_products(id) on delete set null,
    trend_item_id uuid,
    category_ref text check (category_ref is null or length(category_ref) <= 200),
    query text check (query is null or length(query) <= 200),
    price numeric(14,2),
    created_at timestamptz not null default now()
);
create index if not exists idx_commerce_intent_member on public.commerce_intent_events(member_id, created_at desc);
create index if not exists idx_commerce_intent_product on public.commerce_intent_events(product_id, created_at desc)
    where product_id is not null;
create index if not exists idx_commerce_intent_created on public.commerce_intent_events(created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Find It trend links and pools (P3, P5). One row per item (canonical link); shares and wants are
-- per member, so staff handle "37 want this" once.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.commerce_trend_items (
    id uuid primary key default gen_random_uuid(),
    canonical_url text not null unique check (canonical_url ~ '^https://' and length(canonical_url) <= 2000),
    platform text not null check (platform in ('tiktok', 'instagram', 'web')),
    title text check (title is null or length(title) <= 300),
    description text check (description is null or length(description) <= 1000),
    image_url text check (image_url is null or image_url ~ '^https://'),
    author_name text check (author_name is null or length(author_name) <= 200),
    site_name text check (site_name is null or length(site_name) <= 200),
    preview_status text not null default 'pending' check (preview_status in ('pending', 'ok', 'partial', 'failed')),
    preview_fetched_at timestamptz,
    linked_product_id uuid references public.directory_products(id) on delete set null,
    status text not null default 'open' check (status in ('open', 'pooling', 'sourcing', 'closed', 'dismissed')),
    pool_target integer check (pool_target is null or pool_target between 2 and 10000),
    pool_price numeric(14,2) check (pool_price is null or pool_price > 0),
    pool_currency text check (pool_currency is null or pool_currency ~ '^[A-Z]{3}$'),
    pool_deadline timestamptz,
    pool_note text check (pool_note is null or length(pool_note) <= 500),
    share_count integer not null default 0,
    want_count integer not null default 0,
    first_shared_at timestamptz not null default now(),
    last_shared_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint commerce_trend_pool_fields check (
        status <> 'pooling' or (pool_target is not null and pool_price is not null and pool_currency is not null)
    )
);
create index if not exists idx_commerce_trend_items_status on public.commerce_trend_items(status, last_shared_at desc);

alter table public.commerce_intent_events
    drop constraint if exists commerce_intent_events_trend_item_fk;
alter table public.commerce_intent_events
    add constraint commerce_intent_events_trend_item_fk
    foreign key (trend_item_id) references public.commerce_trend_items(id) on delete set null;

create table if not exists public.commerce_trend_shares (
    trend_item_id uuid not null references public.commerce_trend_items(id) on delete cascade,
    member_id uuid not null references auth.users(id) on delete cascade,
    shared_at timestamptz not null default now(),
    primary key (trend_item_id, member_id)
);

create table if not exists public.commerce_pool_members (
    trend_item_id uuid not null references public.commerce_trend_items(id) on delete cascade,
    member_id uuid not null references auth.users(id) on delete cascade,
    quantity integer not null default 1 check (quantity between 1 and 50),
    request_id uuid references public.member_purchase_requests(id) on delete set null,
    joined_at timestamptz not null default now(),
    primary key (trend_item_id, member_id)
);
create index if not exists idx_commerce_pool_members_member on public.commerce_pool_members(member_id, joined_at desc);

-- ---------------------------------------------------------------------------------------------
-- Invoices (P5): sourcing quotes and pool prices paid through Shopify draft-order invoices.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.commerce_invoices (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    request_id uuid references public.member_purchase_requests(id) on delete set null,
    trend_item_id uuid references public.commerce_trend_items(id) on delete set null,
    title text not null check (length(btrim(title)) between 1 and 255),
    amount numeric(14,2) not null check (amount > 0),
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    quantity integer not null default 1 check (quantity between 1 and 50),
    shopify_draft_order_id text unique,
    invoice_url text check (invoice_url is null or invoice_url ~ '^https://'),
    status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'cancelled', 'failed')),
    shopify_order_id text,
    error text check (error is null or length(error) <= 500),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    paid_at timestamptz,
    constraint commerce_invoice_source check (request_id is not null or trend_item_id is not null)
);
create index if not exists idx_commerce_invoices_member on public.commerce_invoices(member_id, created_at desc);
create unique index if not exists uq_commerce_invoices_open_request
    on public.commerce_invoices(request_id) where request_id is not null and status in ('draft', 'sent', 'paid');
create unique index if not exists uq_commerce_invoices_open_pool
    on public.commerce_invoices(trend_item_id, member_id) where trend_item_id is not null and status in ('draft', 'sent', 'paid');

-- ---------------------------------------------------------------------------------------------
-- Flash sales and codes (P6) and giveaways (P7).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.commerce_flash_sales (
    id uuid primary key default gen_random_uuid(),
    title text not null check (length(btrim(title)) between 1 and 120),
    discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),
    value numeric(14,2) not null check (value > 0),
    product_ids uuid[] not null check (cardinality(product_ids) between 1 and 100),
    code text check (code is null or code ~ '^[A-Z0-9_-]{3,40}$'),
    usage_limit integer check (usage_limit is null or usage_limit between 1 and 100000),
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    shopify_discount_id text,
    status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'failed')),
    error text check (error is null or length(error) <= 500),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint commerce_flash_sale_window check (ends_at > starts_at),
    constraint commerce_flash_sale_percentage check (discount_type <> 'percentage' or value <= 90)
);
create index if not exists idx_commerce_flash_sales_window on public.commerce_flash_sales(status, ends_at);

create table if not exists public.commerce_giveaways (
    id uuid primary key default gen_random_uuid(),
    title text not null check (length(btrim(title)) between 1 and 120),
    description text not null default '' check (length(description) <= 2000),
    prize_text text not null check (length(btrim(prize_text)) between 1 and 300),
    prize_product_id uuid references public.directory_products(id) on delete set null,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    winner_count integer not null default 1 check (winner_count between 1 and 50),
    status text not null default 'draft' check (status in ('draft', 'open', 'drawn', 'cancelled')),
    draw_seed text,
    drawn_at timestamptz,
    drawn_by uuid references auth.users(id) on delete set null,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint commerce_giveaway_window check (ends_at > starts_at),
    constraint commerce_giveaway_draw check ((status = 'drawn') = (draw_seed is not null and drawn_at is not null))
);

create table if not exists public.commerce_giveaway_entries (
    giveaway_id uuid not null references public.commerce_giveaways(id) on delete cascade,
    member_id uuid not null references auth.users(id) on delete cascade,
    entered_at timestamptz not null default now(),
    primary key (giveaway_id, member_id)
);

create table if not exists public.commerce_giveaway_winners (
    giveaway_id uuid not null references public.commerce_giveaways(id) on delete cascade,
    member_id uuid not null references auth.users(id) on delete cascade,
    rank integer not null check (rank >= 1),
    prize_code text check (prize_code is null or length(prize_code) <= 60),
    shopify_discount_id text,
    prize_error text check (prize_error is null or length(prize_error) <= 500),
    created_at timestamptz not null default now(),
    primary key (giveaway_id, member_id),
    unique (giveaway_id, rank)
);

-- ---------------------------------------------------------------------------------------------
-- Orders (P8): mirrored from Shopify order webhooks for the member's Orders & requests timeline.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.commerce_orders (
    id uuid primary key default gen_random_uuid(),
    shopify_order_id text not null unique,
    order_name text check (order_name is null or length(order_name) <= 60),
    member_id uuid references auth.users(id) on delete set null,
    customer_email text check (customer_email is null or length(customer_email) <= 320),
    source text not null default 'storefront' check (source in ('storefront', 'invoice', 'other')),
    invoice_id uuid references public.commerce_invoices(id) on delete set null,
    financial_status text check (financial_status is null or length(financial_status) <= 40),
    fulfillment_status text check (fulfillment_status is null or length(fulfillment_status) <= 40),
    cancelled_at timestamptz,
    total numeric(14,2),
    currency text,
    line_items jsonb not null default '[]'::jsonb check (jsonb_typeof(line_items) = 'array'),
    tracking jsonb not null default '[]'::jsonb check (jsonb_typeof(tracking) = 'array'),
    status_url text check (status_url is null or status_url ~ '^https://'),
    placed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_commerce_orders_member on public.commerce_orders(member_id, placed_at desc);

create table if not exists public.commerce_admin_audit (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references auth.users(id) on delete set null,
    action text not null check (length(action) between 1 and 60),
    detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
    created_at timestamptz not null default now()
);
create index if not exists idx_commerce_admin_audit_created on public.commerce_admin_audit(created_at desc);

create or replace function public.prevent_commerce_admin_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'commerce_admin_audit is append-only';
end;
$$;
drop trigger if exists commerce_admin_audit_append_only on public.commerce_admin_audit;
create trigger commerce_admin_audit_append_only
    before update or delete on public.commerce_admin_audit
    for each row execute function public.prevent_commerce_admin_audit_mutation();

-- Find It results are kept with the chat message so a reloaded chat shows the same cards.
alter table public.member_messages add column if not exists find_it jsonb
    check (find_it is null or jsonb_typeof(find_it) = 'object');

-- ---------------------------------------------------------------------------------------------
-- Paid invoice -> the request moves to "purchase confirmed" (which notifies and emails the member
-- through the existing notification and email triggers).
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
    if v_invoice.request_id is null then return 'paid'; end if;
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
    foreach t in array array[
        'commerce_variants', 'commerce_media', 'commerce_sync_runs', 'commerce_webhook_events',
        'commerce_cart_lines', 'commerce_checkouts', 'commerce_intent_events', 'commerce_trend_items',
        'commerce_trend_shares', 'commerce_pool_members', 'commerce_invoices', 'commerce_flash_sales',
        'commerce_giveaways', 'commerce_giveaway_entries', 'commerce_giveaway_winners', 'commerce_orders',
        'commerce_admin_audit'
    ] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on table public.%I from public, anon, authenticated', t);
        execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    end loop;
end;
$$;
grant usage on sequence public.commerce_intent_events_id_seq to service_role;
revoke all on function public.record_commerce_invoice_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.record_commerce_invoice_paid(uuid, text) to service_role;
revoke all on function public.prevent_commerce_admin_audit_mutation() from public, anon, authenticated;

comment on table public.commerce_trend_items is
    'Find It: one row per shared link (canonical URL). Shares and wants are per member; staff link it to a product or run a pool.';
comment on table public.commerce_intent_events is
    'Member shopping signals for the session intent and FayFort-wide Heat. Kept 90 days by the commerce maintenance loop.';
