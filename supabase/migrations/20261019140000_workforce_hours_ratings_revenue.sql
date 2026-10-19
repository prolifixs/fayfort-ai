-- Worker hours, worker ratings, revenue reporting and the Stripe connection (docs/WORKFORCE_AND_REVENUE_PLAN.md).
-- Service role only throughout; the API checks every caller.

-- =============================================================================================
-- 1. Working hours: one row per shift. Breaks accumulate on the shift (break_seconds + on_break_since).
-- =============================================================================================
create table if not exists public.worker_shifts (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references auth.users(id) on delete cascade,
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    break_seconds integer not null default 0 check (break_seconds >= 0),
    on_break_since timestamptz,
    ended_by text check (ended_by is null or ended_by in ('worker', 'auto', 'admin')),
    note text check (note is null or length(note) <= 500),
    flag text check (flag is null or flag in ('auto_ended', 'capped', 'edited')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint worker_shifts_order check (ended_at is null or ended_at >= started_at),
    constraint worker_shifts_closed check ((ended_at is null) = (ended_by is null))
);
-- One open shift per worker.
create unique index if not exists uq_worker_shifts_open on public.worker_shifts(worker_id) where ended_at is null;
create index if not exists idx_worker_shifts_worker on public.worker_shifts(worker_id, started_at desc);
create index if not exists idx_worker_shifts_started on public.worker_shifts(started_at desc);

-- Corrections: requested by the worker (pending) or made by an admin (approved at once). The before/after
-- times stay here as the audit trail.
create table if not exists public.worker_shift_corrections (
    id uuid primary key default gen_random_uuid(),
    shift_id uuid not null references public.worker_shifts(id) on delete cascade,
    worker_id uuid not null references auth.users(id) on delete cascade,
    requested_by uuid references auth.users(id) on delete set null,
    previous_started_at timestamptz not null,
    previous_ended_at timestamptz,
    proposed_started_at timestamptz not null,
    proposed_ended_at timestamptz not null,
    reason text not null check (length(btrim(reason)) between 3 and 500),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    decided_by uuid references auth.users(id) on delete set null,
    decided_at timestamptz,
    created_at timestamptz not null default now(),
    constraint worker_shift_corrections_order check (proposed_ended_at >= proposed_started_at)
);
create index if not exists idx_worker_shift_corrections_status on public.worker_shift_corrections(status, created_at desc);

-- =============================================================================================
-- 2. Worker ratings from customers.
-- A prompt exists per worker per conversation or sourcing request the worker handled. It becomes available two
-- hours after the worker's last reply in a chat (so the chat has gone quiet), or when the request is delivered.
-- =============================================================================================
create table if not exists public.worker_rating_prompts (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references auth.users(id) on delete cascade,
    member_id uuid not null references auth.users(id) on delete cascade,
    conversation_id uuid references public.member_conversations(id) on delete cascade,
    request_id uuid references public.member_purchase_requests(id) on delete cascade,
    title text not null check (length(btrim(title)) between 1 and 200),
    available_after timestamptz not null default now(),
    notified_at timestamptz,
    rated_at timestamptz,
    dismissed_at timestamptz,
    created_at timestamptz not null default now(),
    constraint worker_rating_prompts_one_source check ((conversation_id is null) <> (request_id is null))
);
create unique index if not exists uq_worker_rating_prompts_conversation
    on public.worker_rating_prompts(worker_id, conversation_id) where conversation_id is not null;
create unique index if not exists uq_worker_rating_prompts_request
    on public.worker_rating_prompts(worker_id, request_id) where request_id is not null;
create index if not exists idx_worker_rating_prompts_member on public.worker_rating_prompts(member_id, available_after desc);

create table if not exists public.worker_ratings (
    id uuid primary key default gen_random_uuid(),
    prompt_id uuid not null unique references public.worker_rating_prompts(id) on delete cascade,
    worker_id uuid not null references auth.users(id) on delete cascade,
    member_id uuid references auth.users(id) on delete set null,
    stars smallint not null check (stars between 1 and 5),
    comment text check (comment is null or length(comment) <= 600),
    source text not null check (source in ('chat', 'request')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_worker_ratings_worker on public.worker_ratings(worker_id, created_at desc);

-- Fresh start: a worker's current rating goes back to a perfect 5.0 after every N completed tasks (N set by an
-- admin; 0 turns it off). The all-time history is kept for admins.
create table if not exists public.workforce_settings (
    key text primary key check (key in ('rating_reset_tasks')),
    value jsonb not null,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);
insert into public.workforce_settings(key, value) values ('rating_reset_tasks', '20'::jsonb)
on conflict (key) do nothing;
create index if not exists idx_operations_work_items_completed_by
    on public.operations_work_items(assigned_worker_id, completed_at) where status = 'completed';

create or replace function public.prompt_rating_for_worker_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.sender_type = 'worker' and new.actor_user_id is not null then
        insert into public.worker_rating_prompts(worker_id, member_id, conversation_id, title, available_after)
        select new.actor_user_id, conversation.member_id, conversation.id,
               left(coalesce(nullif(btrim(conversation.title), ''), 'Your chat with FayFort'), 200), now() + interval '2 hours'
          from public.member_conversations conversation
         where conversation.id = new.conversation_id
        on conflict (worker_id, conversation_id) where conversation_id is not null
        do update set available_after = excluded.available_after
            where public.worker_rating_prompts.rated_at is null and public.worker_rating_prompts.notified_at is null;
    end if;
    return new;
end;
$$;
revoke all on function public.prompt_rating_for_worker_reply() from public, anon, authenticated;
drop trigger if exists worker_rating_prompt_on_reply on public.member_messages;
create trigger worker_rating_prompt_on_reply
    after insert on public.member_messages
    for each row execute function public.prompt_rating_for_worker_reply();

create or replace function public.prompt_rating_for_delivered_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.stage = 'delivered' then
        insert into public.worker_rating_prompts(worker_id, member_id, request_id, title, available_after)
        select item.assigned_worker_id, request.member_id, request.id, left(request.request_title, 200), now()
          from public.member_purchase_requests request
          join lateral (
              select work.assigned_worker_id from public.operations_work_items work
               where work.member_request_id = request.id and work.assigned_worker_id is not null
               order by work.updated_at desc limit 1
          ) item on true
         where request.id = new.request_id
        on conflict (worker_id, request_id) where request_id is not null do nothing;
    end if;
    return new;
end;
$$;
revoke all on function public.prompt_rating_for_delivered_request() from public, anon, authenticated;
drop trigger if exists worker_rating_prompt_on_delivery on public.member_request_events;
create trigger worker_rating_prompt_on_delivery
    after insert on public.member_request_events
    for each row execute function public.prompt_rating_for_delivered_request();

-- Notifications: "How was Ada's help?" once a prompt is available (released by the API's sweep).
alter table public.member_notifications
    add column if not exists worker_rating_prompt_id uuid references public.worker_rating_prompts(id) on delete cascade;
alter table public.member_notifications drop constraint if exists member_notifications_notification_type_check;
alter table public.member_notifications add constraint member_notifications_notification_type_check check (notification_type in (
    'request_milestone', 'worker_reply', 'photo_review_status', 'recurring_schedule_update', 'review_invite', 'worker_rating'));
alter table public.member_notifications drop constraint if exists member_notifications_source_check;
alter table public.member_notifications add constraint member_notifications_source_check check (
    (notification_type = 'request_milestone' and request_event_id is not null and worker_message_id is null and review_id is null
        and review_status is null and schedule_event_id is null and review_invite_id is null and worker_rating_prompt_id is null)
    or (notification_type = 'worker_reply' and request_event_id is null and worker_message_id is not null and review_id is null
        and review_status is null and schedule_event_id is null and review_invite_id is null and worker_rating_prompt_id is null)
    or (notification_type = 'photo_review_status' and request_event_id is null and worker_message_id is null and review_id is not null
        and review_status is not null and schedule_event_id is null and review_invite_id is null and worker_rating_prompt_id is null)
    or (notification_type = 'recurring_schedule_update' and request_event_id is null and worker_message_id is null and review_id is null
        and review_status is null and schedule_event_id is not null and review_invite_id is null and worker_rating_prompt_id is null)
    or (notification_type = 'review_invite' and request_event_id is null and worker_message_id is null and review_id is null
        and review_status is null and schedule_event_id is null and review_invite_id is not null and worker_rating_prompt_id is null)
    or (notification_type = 'worker_rating' and request_event_id is null and worker_message_id is null and review_id is null
        and review_status is null and schedule_event_id is null and review_invite_id is null and worker_rating_prompt_id is not null)
);
create unique index if not exists idx_member_notifications_worker_rating
    on public.member_notifications(worker_rating_prompt_id) where worker_rating_prompt_id is not null;

create or replace function public.release_worker_rating_prompts(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = '' as $$
declare
    v_count integer;
begin
    with due as (
        select id, member_id from public.worker_rating_prompts
         where available_after <= now() and notified_at is null and rated_at is null and dismissed_at is null
         order by available_after limit p_limit for update skip locked
    ), marked as (
        update public.worker_rating_prompts prompt set notified_at = now() from due where prompt.id = due.id
        returning prompt.id, prompt.member_id
    )
    insert into public.member_notifications(member_id, notification_type, worker_rating_prompt_id)
    select member_id, 'worker_rating', id from marked
    on conflict (worker_rating_prompt_id) where worker_rating_prompt_id is not null do nothing;
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;
revoke all on function public.release_worker_rating_prompts(integer) from public, anon, authenticated;
grant execute on function public.release_worker_rating_prompts(integer) to service_role;

-- =============================================================================================
-- 3. Revenue: refunds and shipping country on Shopify orders, refunds on Stripe payments, one view of every sale.
-- =============================================================================================
alter table public.commerce_orders
    add column if not exists refunded_amount numeric(14,2) not null default 0 check (refunded_amount >= 0),
    add column if not exists ship_country text check (ship_country is null or length(ship_country) <= 80);
create index if not exists idx_commerce_orders_placed on public.commerce_orders(placed_at desc);

alter table public.member_subscription_payments
    add column if not exists refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0),
    add column if not exists stripe_charge_id text check (stripe_charge_id is null or stripe_charge_id ~ '^(ch|py)_');
create index if not exists idx_member_subscription_payments_paid on public.member_subscription_payments(paid_at desc);

-- One row per sale. A paid Shopify invoice is also a Shopify order: it's counted once, as the order, labelled by
-- the invoice kind.
create or replace view public.revenue_entries with (security_invoker = true) as
select
    'shopify:' || orders.id::text as id,
    'shopify'::text as source,
    case
        when orders.source = 'storefront' then 'shop'
        when invoices.kind = 'order' then 'sourcing'
        when invoices.kind = 'deposit' then 'deposits'
        when invoices.kind = 'consultation' then 'consultations'
        when invoices.kind = 'contact_credits' then 'contact_credits'
        else 'other'
    end as stream,
    coalesce(orders.placed_at, orders.created_at) as occurred_at,
    coalesce(orders.total, 0)::numeric(14,2) as gross,
    least(coalesce(orders.refunded_amount, 0), coalesce(orders.total, 0))::numeric(14,2) as refunded,
    upper(coalesce(orders.currency, 'USD')) as currency,
    orders.member_id,
    orders.ship_country as country,
    orders.order_name as reference,
    orders.line_items
from public.commerce_orders orders
left join public.commerce_invoices invoices on invoices.id = orders.invoice_id
where orders.financial_status in ('paid', 'partially_paid', 'partially_refunded', 'refunded')
union all
select
    'stripe:' || payments.stripe_invoice_id,
    'stripe',
    'memberships',
    payments.paid_at,
    payments.amount::numeric(14,2),
    least(payments.refunded_amount, payments.amount)::numeric(14,2),
    upper(payments.currency),
    payments.member_id,
    null,
    initcap(payments.plan) || ' plan',
    '[]'::jsonb
from public.member_subscription_payments payments;

revoke all on table public.revenue_entries from public, anon, authenticated;
grant select on table public.revenue_entries to service_role;

-- =============================================================================================
-- 4. Connections: Stripe joins Cloudflare as a platform integration (key in Vault), and can be removed.
-- =============================================================================================
alter table public.platform_integrations drop constraint if exists platform_integrations_provider_check;
alter table public.platform_integrations add constraint platform_integrations_provider_check
    check (provider in ('cloudflare', 'stripe'));

create or replace function public.set_platform_integration_credentials(
    p_provider text,
    p_secret_payload jsonb,
    p_safe_settings jsonb,
    p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_secret_id uuid;
    v_secret_name text;
begin
    if p_provider not in ('cloudflare', 'stripe') then
        raise exception 'unsupported platform integration';
    end if;
    if p_secret_payload is null or jsonb_typeof(p_secret_payload) <> 'object' then
        raise exception 'credential payload must be an object';
    end if;
    if p_safe_settings is null or jsonb_typeof(p_safe_settings) <> 'object' then
        raise exception 'safe settings must be an object';
    end if;

    insert into public.platform_integrations (provider) values (p_provider)
    on conflict (provider) do nothing;

    select pi.credential_secret_id into v_secret_id
    from public.platform_integrations as pi
    where pi.provider = p_provider
    for update;

    v_secret_name := 'platform_integration_' || p_provider;
    if v_secret_id is null then
        v_secret_id := vault.create_secret(p_secret_payload::text, v_secret_name, 'FayFort platform integration credentials');
    else
        perform vault.update_secret(v_secret_id, p_secret_payload::text, v_secret_name, 'FayFort platform integration credentials');
    end if;

    update public.platform_integrations
    set credential_secret_id = v_secret_id,
        status = 'configured',
        safe_settings = p_safe_settings,
        health_checked_at = null,
        health_error_code = null,
        updated_by = p_actor_id,
        updated_at = now()
    where provider = p_provider;

    insert into public.platform_infrastructure_events (actor_id, action, details)
    values (p_actor_id, 'integration.credentials_saved', jsonb_build_object('provider', p_provider));
    return true;
end;
$$;

create or replace function public.clear_platform_integration_credentials(p_provider text, p_actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_secret_id uuid;
begin
    select credential_secret_id into v_secret_id from public.platform_integrations where provider = p_provider for update;
    update public.platform_integrations
       set credential_secret_id = null, status = 'not_configured', safe_settings = '{}'::jsonb,
           health_checked_at = null, health_error_code = null, updated_by = p_actor_id, updated_at = now()
     where provider = p_provider;
    if v_secret_id is not null then
        delete from vault.secrets where id = v_secret_id;
    end if;
    insert into public.platform_infrastructure_events (actor_id, action, details)
    values (p_actor_id, 'integration.credentials_removed', jsonb_build_object('provider', p_provider));
    return true;
end;
$$;
revoke all on function public.set_platform_integration_credentials(text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.clear_platform_integration_credentials(text, uuid) from public, anon, authenticated;
grant execute on function public.set_platform_integration_credentials(text, jsonb, jsonb, uuid) to service_role;
grant execute on function public.clear_platform_integration_credentials(text, uuid) to service_role;

-- =============================================================================================
alter table public.worker_shifts enable row level security;
alter table public.worker_shift_corrections enable row level security;
alter table public.worker_rating_prompts enable row level security;
alter table public.worker_ratings enable row level security;
alter table public.workforce_settings enable row level security;
revoke all on table public.worker_shifts, public.worker_shift_corrections, public.worker_rating_prompts,
    public.worker_ratings, public.workforce_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.worker_shifts, public.worker_shift_corrections,
    public.worker_rating_prompts, public.worker_ratings, public.workforce_settings to service_role;

comment on table public.worker_shifts is 'Clock in / clock out per worker (Operations header). Auto-ended after 30 minutes without a heartbeat.';
comment on table public.worker_ratings is 'Customer ratings of the FayFort worker who helped them (chat or delivered request).';
comment on view public.revenue_entries is 'Every Shopify sale (orders and paid invoices, counted once) and Stripe membership payment, with refunds.';
