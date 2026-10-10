-- Keep shared directory status changes and their business review history atomic.
create or replace function public.review_directory_record(
    p_business_id uuid,
    p_reviewer_user_id uuid,
    p_source_table text,
    p_record_id uuid,
    p_tool_id text,
    p_verification_status text,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    prior_status text;
begin
    if p_source_table not in (
        'directory_markets', 'directory_contacts', 'directory_service_providers',
        'directory_hotels', 'directory_restaurants', 'directory_city_guides'
    ) then
        raise exception 'Unsupported directory source table';
    end if;
    if p_verification_status not in ('verified', 'unverified', 'unknown', 'conflicting') then
        raise exception 'Unsupported verification status';
    end if;
    if length(trim(coalesce(p_reason, ''))) not between 8 and 500 then
        raise exception 'Review reason must contain 8 to 500 characters';
    end if;

    prior_status := null;
    execute format('select coalesce(verification_status, ''unknown'') from public.%I where id = $1 for update', p_source_table)
        into prior_status using p_record_id;
    if prior_status is null then
        return jsonb_build_object('error', 'not_found');
    end if;

    execute format('update public.%I set verification_status = $1 where id = $2', p_source_table)
        using p_verification_status, p_record_id;

    insert into public.directory_verification_reviews (
        business_id, reviewer_user_id, source_table, record_id, tool_id,
        previous_status, verification_status, reason
    ) values (
        p_business_id, p_reviewer_user_id, p_source_table, p_record_id, p_tool_id,
        prior_status, p_verification_status, trim(p_reason)
    );

    return jsonb_build_object('previous_status', prior_status, 'verification_status', p_verification_status);
end;
$$;

revoke all on function public.review_directory_record(uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.review_directory_record(uuid, uuid, text, uuid, text, text, text) to service_role;
