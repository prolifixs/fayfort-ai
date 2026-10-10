-- Apply an allowlisted workspace settings update and its audit event atomically.
create or replace function public.update_business_settings(
    p_business_id uuid,
    p_updated_by uuid,
    p_expected_updated_at timestamptz,
    p_update_name boolean,
    p_name text,
    p_update_description boolean,
    p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    updated_business public.businesses%rowtype;
    fields text[] := array[]::text[];
begin
    if not p_update_name and not p_update_description then
        raise exception 'At least one allowlisted settings field is required';
    end if;
    if p_update_name and (p_name is null or length(trim(p_name)) not between 1 and 120) then
        raise exception 'Business name must contain 1 to 120 characters';
    end if;
    if p_update_description and p_description is not null and length(trim(p_description)) > 500 then
        raise exception 'Business description must be at most 500 characters';
    end if;

    update public.businesses
    set name = case when p_update_name then trim(p_name) else name end,
        description = case when p_update_description then nullif(trim(p_description), '') else description end,
        updated_at = clock_timestamp()
    where id = p_business_id and updated_at = p_expected_updated_at
    returning * into updated_business;

    if not found then
        if exists (select 1 from public.businesses where id = p_business_id) then
            return jsonb_build_object('error', 'conflict');
        end if;
        return jsonb_build_object('error', 'not_found');
    end if;

    if p_update_name then fields := array_append(fields, 'name'); end if;
    if p_update_description then fields := array_append(fields, 'description'); end if;

    insert into public.business_events (business_id, event_type, entity_type, entity_id, payload)
    values (
        p_business_id,
        'business.settings_updated',
        'business',
        p_business_id::text,
        jsonb_build_object('updated_fields', array_to_string(fields, ','), 'updated_by', p_updated_by::text)
    );

    return jsonb_build_object(
        'id', updated_business.id,
        'name', updated_business.name,
        'description', updated_business.description,
        'created_at', updated_business.created_at,
        'updated_at', updated_business.updated_at
    );
end;
$$;

revoke all on function public.update_business_settings(uuid, uuid, timestamptz, boolean, text, boolean, text) from public, anon, authenticated;
grant execute on function public.update_business_settings(uuid, uuid, timestamptz, boolean, text, boolean, text) to service_role;
