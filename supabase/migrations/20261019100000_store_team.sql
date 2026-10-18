-- Store team (docs/CATALOG_MERCHANDISING_PLAN.md §2–3): a sixth Operations department for catalog work.
-- Workers prepare store products and sourcing listings here; a store product goes to Shopify as a DRAFT and only a
-- platform administrator publishes it. Listings also carry the richer sourcing fields (price guide, minimum order,
-- lead time) and the dates the retire rules need.

-- 1. The department. Constraint names are found from the catalog so this works whatever the database named them.
do $$
declare
    v_table text;
    v_name text;
begin
    foreach v_table in array array['operations_worker_departments', 'operations_department_events', 'operations_work_items'] loop
        for v_name in
            select con.conname from pg_constraint con
             where con.conrelid = format('public.%I', v_table)::regclass and con.contype = 'c'
               and pg_get_constraintdef(con.oid) like '%member_support%'
        loop
            execute format('alter table public.%I drop constraint %I', v_table, v_name);
        end loop;
        execute format(
            'alter table public.%I add constraint %I check (department in (''conversation_intake'', ''sourcing'', '
            '''fulfillment'', ''disputes'', ''member_support'', ''store_team''))',
            v_table, v_table || '_department_check');
    end loop;
end;
$$;

create or replace function public.set_operations_worker_departments(
    p_actor_id uuid,
    p_worker_id uuid,
    p_departments text[]
) returns setof public.operations_worker_departments
language plpgsql security definer set search_path = '' as $$
begin
    if not exists (select 1 from public.fayfort_workers where user_id = p_worker_id and status = 'active') then
        raise exception 'only active FayFort workers can receive department access';
    end if;
    if exists (select 1 from unnest(coalesce(p_departments, array[]::text[])) item
        where item not in ('conversation_intake', 'sourcing', 'fulfillment', 'disputes', 'member_support', 'store_team')) then
        raise exception 'unknown operations department';
    end if;
    insert into public.operations_department_events(worker_id, department, action, actor_id)
    select existing_mapping.worker_id, existing_mapping.department, 'disabled', p_actor_id
      from public.operations_worker_departments existing_mapping
     where existing_mapping.worker_id = p_worker_id
       and not (existing_mapping.department = any(coalesce(p_departments, array[]::text[])));
    insert into public.operations_department_events(worker_id, department, action, actor_id)
    select p_worker_id, desired.department, 'enabled', p_actor_id
      from unnest(coalesce(p_departments, array[]::text[])) desired(department)
     where not exists (select 1 from public.operations_worker_departments existing_mapping
        where existing_mapping.worker_id = p_worker_id and existing_mapping.department = desired.department);
    delete from public.operations_worker_departments existing_mapping
     where existing_mapping.worker_id = p_worker_id
       and not (existing_mapping.department = any(coalesce(p_departments, array[]::text[])));
    insert into public.operations_worker_departments(worker_id, department, can_claim, created_by)
    select p_worker_id, desired.department, true, p_actor_id
      from unnest(coalesce(p_departments, array[]::text[])) desired(department)
    on conflict (worker_id, department) do nothing;
    return query select * from public.operations_worker_departments where worker_id = p_worker_id order by department;
end;
$$;
revoke all on function public.set_operations_worker_departments(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.set_operations_worker_departments(uuid, uuid, text[]) to service_role;

-- 2. Inbox notices for reviews: admins hear when a listing waits for them, the worker hears the outcome.
alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in (
        'assigned', 'reassigned', 'member_replied', 'mentioned',
        'work_due', 'work_overdue', 'automation_failed', 'infrastructure_alert',
        'review_needed', 'review_done'
    ));

-- One inbox notice per platform admin (a listing waiting for review, a store product to archive).
create or replace function public.notify_platform_admins(
    p_notification_type text,
    p_work_item_id uuid,
    p_title text,
    p_body text,
    p_href text,
    p_dedupe text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
    v_count integer;
begin
    insert into public.operations_worker_notifications(
        worker_id, work_item_id, notification_type, title, body, href, dedupe_key)
    select users.id, p_work_item_id, p_notification_type, left(p_title, 160), left(p_body, 500),
           coalesce(nullif(p_href, ''), '/operations'), left(p_dedupe, 200) || ':' || users.id::text
      from auth.users as users
     where users.raw_app_meta_data ->> 'platform_admin' = 'true'
        or coalesce(users.raw_app_meta_data -> 'roles', '[]'::jsonb) @> '["platform_admin"]'::jsonb
    on conflict (dedupe_key) do nothing;
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;
revoke all on function public.notify_platform_admins(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_platform_admins(text, uuid, text, text, text, text) to service_role;

-- 3. Catalog fields. Sourcing listings use price_min/price_max/currency as their price guide ("from–to").
alter table public.directory_products
    add column if not exists min_order integer,
    add column if not exists lead_time_min_days smallint,
    add column if not exists lead_time_max_days smallint,
    add column if not exists sold_out_since timestamptz,
    add column if not exists retire_snoozed_until timestamptz,
    add column if not exists retired_at timestamptz,
    add column if not exists retired_reason text;
alter table public.directory_products
    drop constraint if exists directory_products_min_order_check,
    drop constraint if exists directory_products_lead_time_check,
    drop constraint if exists directory_products_retired_reason_check;
alter table public.directory_products
    add constraint directory_products_min_order_check check (min_order is null or min_order between 1 and 1000000),
    add constraint directory_products_lead_time_check check (
        (lead_time_min_days is null or lead_time_min_days between 0 and 365)
        and (lead_time_max_days is null or lead_time_max_days between 0 and 365)
        and (lead_time_min_days is null or lead_time_max_days is null or lead_time_max_days >= lead_time_min_days)),
    add constraint directory_products_retired_reason_check check (retired_reason is null or length(retired_reason) <= 500);

-- Store products that are sold out today start their 30-day clock now.
update public.directory_products set sold_out_since = now()
 where source = 'shopify' and in_stock is false and sold_out_since is null;

-- 4. A listing: a store product or sourcing item being prepared, reviewed and published (or an edit to one).
create table if not exists public.store_listings (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('store_product', 'sourcing_item')),
    action text not null default 'create' check (action in ('create', 'update')),
    status text not null default 'draft'
        check (status in ('draft', 'in_review', 'changes_requested', 'published', 'cancelled', 'failed')),
    product_id uuid references public.directory_products(id) on delete set null,
    shopify_product_id text,
    trend_item_id uuid references public.commerce_trend_items(id) on delete set null,
    title text not null default '' check (length(title) <= 160),
    description text not null default '' check (length(description) <= 5000),
    category_ref text references public.directory_categories(source_ref) on update cascade on delete set null,
    option_name text check (option_name is null or length(btrim(option_name)) between 1 and 60),
    option_values text[] not null default '{}' check (cardinality(option_values) <= 30),
    price numeric(14,2) check (price is null or price > 0),
    compare_at_price numeric(14,2) check (compare_at_price is null or compare_at_price > 0),
    cost numeric(14,2) check (cost is null or cost >= 0),
    currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
    price_guide_min numeric(14,2) check (price_guide_min is null or price_guide_min > 0),
    price_guide_max numeric(14,2) check (price_guide_max is null or price_guide_max > 0),
    min_order integer check (min_order is null or min_order between 1 and 1000000),
    lead_time_min_days smallint check (lead_time_min_days is null or lead_time_min_days between 0 and 365),
    lead_time_max_days smallint check (lead_time_max_days is null or lead_time_max_days between 0 and 365),
    availability_status text not null default 'sourcing' check (availability_status in ('available', 'sourcing', 'unavailable')),
    media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10),
    planned_live_at timestamptz,
    review_note text check (review_note is null or length(review_note) <= 1000),
    error text check (error is null or length(error) <= 500),
    created_by uuid references auth.users(id) on delete set null,
    submitted_by uuid references auth.users(id) on delete set null,
    submitted_at timestamptz,
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint store_listings_price_guide check (
        price_guide_min is null or price_guide_max is null or price_guide_max >= price_guide_min),
    constraint store_listings_lead_time check (
        lead_time_min_days is null or lead_time_max_days is null or lead_time_max_days >= lead_time_min_days),
    constraint store_listings_update_target check (action = 'create' or product_id is not null)
);
create index if not exists idx_store_listings_status on public.store_listings(status, updated_at desc);
create index if not exists idx_store_listings_product on public.store_listings(product_id) where product_id is not null;
create unique index if not exists uq_store_listings_open_trend
    on public.store_listings(trend_item_id)
    where trend_item_id is not null and status in ('draft', 'in_review', 'changes_requested');

alter table public.store_listings enable row level security;
revoke all on table public.store_listings from public, anon, authenticated;
grant select, insert, update, delete on table public.store_listings to service_role;

comment on table public.store_listings is
    'Store team work in progress: a product or sourcing item being prepared, reviewed by an admin and published. Service role only.';
