-- Keep the database-side reservation invariant independent from the Python caller.
-- Price discovery remains the application's responsibility; this prevents a caller
-- from reserving less than the supplied token caps and rates require.
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
    v_minimum_reservation bigint;
    v_month_start timestamptz := date_trunc('month', timezone('UTC', now())) at time zone 'UTC';
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if p_operation not in ('intent', 'response', 'summary')
       or p_model is null or length(trim(p_model)) = 0
       or p_provider is null or length(trim(p_provider)) = 0
       or p_reserved_micro_usd < 0
       or p_max_input_tokens < 0
       or p_max_output_tokens < 0
       or p_input_price_micro_usd_per_million < 0
       or p_output_price_micro_usd_per_million < 0 then
        raise exception 'invalid_ai_budget_reservation' using errcode = '22023';
    end if;

    v_minimum_reservation := ceil(
        (p_max_input_tokens::numeric * p_input_price_micro_usd_per_million::numeric
         + p_max_output_tokens::numeric * p_output_price_micro_usd_per_million::numeric)
        / 1000000
    )::bigint;
    if p_reserved_micro_usd < v_minimum_reservation then
        raise exception 'ai_budget_reservation_understated' using errcode = '22023';
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

revoke all on function public.reserve_ai_usage_budget(uuid, uuid, text, text, text, bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage_budget(uuid, uuid, text, text, text, bigint, bigint, bigint, bigint, bigint) to service_role;
