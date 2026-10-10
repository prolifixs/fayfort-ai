create table if not exists public.business_ai_budgets (
    business_id uuid primary key references public.businesses(id) on delete cascade,
    monthly_limit_micro_usd bigint not null default 25000000 check (monthly_limit_micro_usd >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.business_ai_budgets (business_id)
select id from public.businesses
on conflict (business_id) do nothing;

create or replace function public.create_business_ai_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.business_ai_budgets (business_id)
    values (new.id)
    on conflict (business_id) do nothing;
    return new;
end;
$$;

drop trigger if exists businesses_create_ai_budget on public.businesses;
create trigger businesses_create_ai_budget
    after insert on public.businesses
    for each row execute function public.create_business_ai_budget();

create table if not exists public.ai_usage_reservations (
    request_id uuid primary key,
    business_id uuid not null references public.businesses(id) on delete cascade,
    operation text not null check (operation in ('intent', 'response', 'summary')),
    model text not null,
    provider text not null,
    input_price_micro_usd_per_million bigint not null check (input_price_micro_usd_per_million >= 0),
    output_price_micro_usd_per_million bigint not null check (output_price_micro_usd_per_million >= 0),
    max_input_tokens bigint not null check (max_input_tokens >= 0),
    max_output_tokens bigint not null check (max_output_tokens >= 0),
    reserved_micro_usd bigint not null check (reserved_micro_usd >= 0),
    actual_micro_usd bigint,
    reservation_status text not null check (reservation_status in ('reserved', 'settled', 'uncertain', 'released')),
    created_at timestamptz not null default now(),
    settled_at timestamptz,
    constraint ai_usage_reservations_actual_nonnegative check (actual_micro_usd is null or actual_micro_usd >= 0)
);

create index if not exists idx_ai_usage_reservations_business_created
    on public.ai_usage_reservations (business_id, created_at desc);

alter table public.ai_usage_reservations enable row level security;
alter table public.business_ai_budgets enable row level security;
revoke all on table public.ai_usage_reservations, public.business_ai_budgets from anon, authenticated;
grant select, insert, update on table public.ai_usage_reservations to service_role;
grant select, insert, update on table public.business_ai_budgets to service_role;

create or replace function public.reserve_ai_usage_budget(
    p_request_id uuid,
    p_business_id uuid,
    p_operation text,
    p_model text,
    p_provider text,
    p_input_price_micro_usd_per_million bigint,
    p_output_price_micro_usd_per_million bigint,
    p_max_input_tokens bigint,
    p_max_output_tokens bigint,
    p_reserved_micro_usd bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit bigint;
    v_committed bigint;
    v_month_start timestamptz := date_trunc('month', timezone('UTC', now())) at time zone 'UTC';
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if p_operation not in ('intent', 'response', 'summary')
       or p_reserved_micro_usd < 0
       or p_max_input_tokens < 0
       or p_max_output_tokens < 0
       or p_input_price_micro_usd_per_million < 0
       or p_output_price_micro_usd_per_million < 0 then
        raise exception 'invalid_ai_budget_reservation' using errcode = '22023';
    end if;

    select monthly_limit_micro_usd into v_limit
    from public.business_ai_budgets
    where business_id = p_business_id
    for update;

    if not found then
        raise exception 'ai_budget_not_configured' using errcode = 'P0002';
    end if;

    select coalesce(sum(
        case when reservation_status = 'settled' then actual_micro_usd
             else reserved_micro_usd end
    ), 0)::bigint into v_committed
    from public.ai_usage_reservations
    where business_id = p_business_id
      and created_at >= v_month_start
      and reservation_status <> 'released';

    if v_committed + p_reserved_micro_usd > v_limit then
        return jsonb_build_object(
            'allowed', false,
            'reason', 'monthly_budget_exceeded',
            'limit_micro_usd', v_limit,
            'committed_micro_usd', v_committed,
            'remaining_micro_usd', greatest(v_limit - v_committed, 0)
        );
    end if;

    insert into public.ai_usage_reservations (
        request_id, business_id, operation, model, provider,
        input_price_micro_usd_per_million, output_price_micro_usd_per_million,
        max_input_tokens, max_output_tokens, reserved_micro_usd, reservation_status
    ) values (
        p_request_id, p_business_id, p_operation, p_model, p_provider,
        p_input_price_micro_usd_per_million, p_output_price_micro_usd_per_million,
        p_max_input_tokens, p_max_output_tokens, p_reserved_micro_usd, 'reserved'
    );

    return jsonb_build_object(
        'allowed', true,
        'request_id', p_request_id,
        'limit_micro_usd', v_limit,
        'committed_micro_usd', v_committed,
        'remaining_micro_usd', greatest(v_limit - v_committed - p_reserved_micro_usd, 0),
        'reserved_micro_usd', p_reserved_micro_usd
    );
end;
$$;

create or replace function public.settle_ai_usage_budget(
    p_request_id uuid,
    p_actual_micro_usd bigint,
    p_reservation_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if p_reservation_status not in ('settled', 'uncertain')
       or (p_reservation_status = 'settled' and (p_actual_micro_usd is null or p_actual_micro_usd < 0))
       or (p_reservation_status = 'uncertain' and p_actual_micro_usd is not null) then
        raise exception 'invalid_ai_budget_settlement' using errcode = '22023';
    end if;

    update public.ai_usage_reservations
       set reservation_status = p_reservation_status,
           actual_micro_usd = p_actual_micro_usd,
           settled_at = now()
     where request_id = p_request_id
       and reservation_status = 'reserved';
    if not found then
        raise exception 'ai_budget_reservation_not_found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.get_ai_usage_budget_status(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit bigint;
    v_committed bigint;
    v_pending bigint;
    v_month_start timestamptz := date_trunc('month', timezone('UTC', now())) at time zone 'UTC';
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    select monthly_limit_micro_usd into v_limit
    from public.business_ai_budgets where business_id = p_business_id;
    if not found then
        raise exception 'ai_budget_not_configured' using errcode = 'P0002';
    end if;
    select
      coalesce(sum(case when reservation_status = 'settled' then actual_micro_usd else reserved_micro_usd end), 0)::bigint,
      coalesce(sum(case when reservation_status in ('reserved', 'uncertain') then reserved_micro_usd else 0 end), 0)::bigint
      into v_committed, v_pending
    from public.ai_usage_reservations
    where business_id = p_business_id
      and created_at >= v_month_start
      and reservation_status <> 'released';
    return jsonb_build_object(
      'month_start', v_month_start,
      'limit_micro_usd', v_limit,
      'committed_micro_usd', v_committed,
      'pending_micro_usd', v_pending,
      'remaining_micro_usd', greatest(v_limit - v_committed, 0)
    );
end;
$$;

revoke all on function public.reserve_ai_usage_budget(uuid, uuid, text, text, text, bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.settle_ai_usage_budget(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.get_ai_usage_budget_status(uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage_budget(uuid, uuid, text, text, text, bigint, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.settle_ai_usage_budget(uuid, bigint, text) to service_role;
grant execute on function public.get_ai_usage_budget_status(uuid) to service_role;

alter table public.ai_usage_events
    add column if not exists provider text,
    add column if not exists estimated_cost_micro_usd bigint,
    add column if not exists actual_cost_micro_usd bigint,
    add column if not exists budget_reservation_id uuid references public.ai_usage_reservations(request_id) on delete set null;

comment on table public.ai_usage_reservations is
    'Fail-closed pre-inference dollar reservations; unresolved provider outcomes retain their full reservation against the business monthly ceiling.';
comment on table public.business_ai_budgets is
    'Business-scoped AI spend ceiling in micro-USD; defaults to $25 per UTC calendar month.';
