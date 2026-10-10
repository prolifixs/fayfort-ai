-- Allow an explicitly rejected provider request to release its pre-inference hold.
-- Network failures and ambiguous provider outcomes remain 'uncertain' and charged.
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
    if p_reservation_status not in ('settled', 'uncertain', 'released')
       or (p_reservation_status = 'settled' and (p_actual_micro_usd is null or p_actual_micro_usd < 0))
       or (p_reservation_status in ('uncertain', 'released') and p_actual_micro_usd is not null) then
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

revoke all on function public.settle_ai_usage_budget(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.settle_ai_usage_budget(uuid, bigint, text) to service_role;
