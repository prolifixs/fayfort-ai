create extension if not exists supabase_vault with schema vault;

alter table public.business_connections
    add column if not exists provider_account_id text,
    add column if not exists provider_username text;

create index if not exists idx_business_connections_provider_account
    on public.business_connections(provider, provider_account_id)
    where provider_account_id is not null;

alter table public.business_connections
    add column if not exists credential_secret_id uuid
        references vault.secrets(id) on delete set null;

create or replace function public.set_business_connection_credentials(
    p_business_id uuid,
    p_connection_id uuid,
    p_secret_payload jsonb
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
    if p_secret_payload is null or jsonb_typeof(p_secret_payload) <> 'object' then
        raise exception 'credential payload must be an object';
    end if;

    select bc.credential_secret_id into v_secret_id
    from public.business_connections as bc
    where bc.business_id = p_business_id and bc.id = p_connection_id
    for update;
    if not found then
        return false;
    end if;

    v_secret_name := 'business_connection_' || p_connection_id::text;
    if v_secret_id is null then
        v_secret_id := vault.create_secret(
            p_secret_payload::text,
            v_secret_name,
            'FayFort provider credentials'
        );
    else
        perform vault.update_secret(
            v_secret_id,
            p_secret_payload::text,
            v_secret_name,
            'FayFort provider credentials'
        );
    end if;

    update public.business_connections
    set credential_secret_id = v_secret_id,
        credential_status = 'configured',
        provider_account_id = null,
        provider_username = null,
        status = 'setup_required'
    where business_id = p_business_id and id = p_connection_id;
    return true;
end;
$$;

create or replace function public.get_business_connection_credentials(
    p_business_id uuid,
    p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_payload jsonb;
begin
    select ds.decrypted_secret::jsonb into v_payload
    from public.business_connections as bc
    join vault.decrypted_secrets as ds on ds.id = bc.credential_secret_id
    where bc.business_id = p_business_id and bc.id = p_connection_id;
    return v_payload;
end;
$$;

revoke all on function public.set_business_connection_credentials(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_business_connection_credentials(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_business_connection_credentials(uuid, uuid, jsonb) to service_role;
grant execute on function public.get_business_connection_credentials(uuid, uuid) to service_role;
