-- Customer reviews on www.fayfort.com (docs/PUBLIC_SITE_REBUILD_PLAN.md, "Customer reviews").
-- Two ways in, one list:
--   * staff upload a screenshot of a review a customer sent (Instagram, WhatsApp...); the API reads the text and
--     staff check it before publishing (Control Center -> Website);
--   * members review an order or sourcing request themselves once it ships (Orders & requests).
-- Nothing is public until staff publish it. Only service_role touches these tables; the API checks every caller.

create table if not exists public.customer_review_invites (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    request_id uuid references public.member_purchase_requests(id) on delete cascade,
    order_id uuid references public.commerce_orders(id) on delete cascade,
    title text not null check (length(btrim(title)) between 1 and 200),
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    dismissed_at timestamptz,
    constraint customer_review_invites_one_source check ((request_id is null) <> (order_id is null))
);
create unique index if not exists idx_customer_review_invites_request
    on public.customer_review_invites(request_id) where request_id is not null;
create unique index if not exists idx_customer_review_invites_order
    on public.customer_review_invites(order_id) where order_id is not null;
create index if not exists idx_customer_review_invites_member
    on public.customer_review_invites(member_id, created_at desc);

create table if not exists public.customer_reviews (
    id uuid primary key default gen_random_uuid(),
    source text not null check (source in ('member', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'email', 'google', 'other')),
    status text not null default 'pending' check (status in ('pending', 'published', 'hidden')),
    featured boolean not null default false,
    rating smallint check (rating is null or rating between 1 and 5),
    body text not null default '' check (length(body) <= 1500),
    display_name text check (display_name is null or length(btrim(display_name)) between 1 and 60),
    country text check (country is null or length(btrim(country)) between 1 and 60),
    product text check (product is null or length(btrim(product)) between 1 and 120),
    reviewed_on date,
    member_id uuid references auth.users(id) on delete set null,
    invite_id uuid unique references public.customer_review_invites(id) on delete set null,
    screenshot_path text check (screenshot_path is null or length(screenshot_path) <= 300),
    ocr_text text check (ocr_text is null or length(ocr_text) <= 8000),
    staff_note text check (staff_note is null or length(staff_note) <= 500),
    created_by uuid references auth.users(id) on delete set null,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- A published review always has words and a name to show.
    constraint customer_reviews_publishable check (
        status <> 'published' or (length(btrim(body)) >= 3 and display_name is not null)
    )
);
create index if not exists idx_customer_reviews_public
    on public.customer_reviews(status, featured desc, published_at desc);
create index if not exists idx_customer_reviews_member on public.customer_reviews(member_id);

alter table public.customer_review_invites enable row level security;
alter table public.customer_reviews enable row level security;
revoke all on table public.customer_review_invites, public.customer_reviews from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_review_invites, public.customer_reviews to service_role;

-- Review screenshots stay private; staff see them through short signed links.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('review-screenshots', 'review-screenshots', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Invites: a sourcing request that ships, or a shop order Shopify marks shipped.
create or replace function public.invite_review_for_request_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.stage in ('shipped', 'in_transit', 'out_for_delivery', 'delivered') then
        insert into public.customer_review_invites(member_id, request_id, title)
        select request.member_id, request.id, left(request.request_title, 200)
          from public.member_purchase_requests request
         where request.id = new.request_id
        on conflict (request_id) where request_id is not null do nothing;
    end if;
    return new;
end;
$$;
revoke all on function public.invite_review_for_request_event() from public, anon, authenticated;
drop trigger if exists customer_review_invite_request on public.member_request_events;
create trigger customer_review_invite_request
    after insert on public.member_request_events
    for each row execute function public.invite_review_for_request_event();

create or replace function public.invite_review_for_shop_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    v_first text;
begin
    if new.member_id is not null and new.cancelled_at is null
       and new.fulfillment_status in ('fulfilled', 'partial') then
        v_first := nullif(btrim(coalesce(new.line_items -> 0 ->> 'title', '')), '');
        insert into public.customer_review_invites(member_id, order_id, title)
        values (new.member_id, new.id, left(concat_ws(' · ', coalesce(new.order_name, 'Shop order'), v_first), 200))
        on conflict (order_id) where order_id is not null do nothing;
    end if;
    return new;
end;
$$;
revoke all on function public.invite_review_for_shop_order() from public, anon, authenticated;
drop trigger if exists customer_review_invite_order on public.commerce_orders;
create trigger customer_review_invite_order
    after insert or update of fulfillment_status on public.commerce_orders
    for each row execute function public.invite_review_for_shop_order();

-- Each invite is a member notification ("How was your order?"), which also queues the usual email.
alter table public.member_notifications
    add column if not exists review_invite_id uuid references public.customer_review_invites(id) on delete cascade;

alter table public.member_notifications
    drop constraint if exists member_notifications_notification_type_check;
alter table public.member_notifications
    add constraint member_notifications_notification_type_check check (notification_type in (
        'request_milestone', 'worker_reply', 'photo_review_status', 'recurring_schedule_update', 'review_invite'
    ));

alter table public.member_notifications
    drop constraint if exists member_notifications_source_check;
alter table public.member_notifications
    add constraint member_notifications_source_check check (
        (notification_type = 'request_milestone' and request_event_id is not null and worker_message_id is null
            and review_id is null and review_status is null and schedule_event_id is null and review_invite_id is null)
        or (notification_type = 'worker_reply' and request_event_id is null and worker_message_id is not null
            and review_id is null and review_status is null and schedule_event_id is null and review_invite_id is null)
        or (notification_type = 'photo_review_status' and request_event_id is null and worker_message_id is null
            and review_id is not null and review_status is not null and schedule_event_id is null and review_invite_id is null)
        or (notification_type = 'recurring_schedule_update' and request_event_id is null and worker_message_id is null
            and review_id is null and review_status is null and schedule_event_id is not null and review_invite_id is null)
        or (notification_type = 'review_invite' and request_event_id is null and worker_message_id is null
            and review_id is null and review_status is null and schedule_event_id is null and review_invite_id is not null)
    );
create unique index if not exists idx_member_notifications_review_invite
    on public.member_notifications(review_invite_id) where review_invite_id is not null;

create or replace function public.notify_member_review_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.member_notifications(member_id, notification_type, review_invite_id)
    values (new.member_id, 'review_invite', new.id)
    on conflict (review_invite_id) where review_invite_id is not null do nothing;
    return new;
end;
$$;
revoke all on function public.notify_member_review_invite() from public, anon, authenticated;
drop trigger if exists customer_review_invite_notification on public.customer_review_invites;
create trigger customer_review_invite_notification
    after insert on public.customer_review_invites
    for each row execute function public.notify_member_review_invite();

comment on table public.customer_reviews is
    'Reviews shown on www.fayfort.com: member reviews of shipped orders and staff-checked screenshots of reviews customers sent. Published only by staff.';
comment on table public.customer_review_invites is
    'One per shipped sourcing request or shop order: lets the member leave a review from Orders & requests.';
