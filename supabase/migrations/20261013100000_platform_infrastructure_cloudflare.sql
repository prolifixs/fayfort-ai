-- Platform consolidation plan, Gate 3: Cloudflare inside FayFort AI.
-- Platform-level (not business-scoped) integrations, webhook endpoint registry and an audit trail.
-- Service-role only: no anon/authenticated access; the API enforces platform-admin identity.

create extension if not exists supabase_vault with schema vault;

create table if not exists public.platform_integrations (
    provider text primary key check (provider in ('cloudflare')),
    status text not null default 'not_configured'
        check (status in ('not_configured', 'configured', 'verified', 'error')),
    safe_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_settings) = 'object'),
    credential_secret_id uuid references vault.secrets(id) on delete set null,
    health_checked_at timestamptz,
    health_error_code text,
    updated_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.platform_webhook_endpoints (
    channel text primary key check (channel in ('instagram', 'messenger')),
    public_url text not null check (public_url ~ '^https://[^/\s]+(/.*)?$'),
    last_preflight_at timestamptz,
    last_preflight_ok boolean,
    last_preflight_results jsonb not null default '[]'::jsonb check (jsonb_typeof(last_preflight_results) = 'array'),
    updated_by uuid,
    updated_at timestamptz not null default now()
);

create table if not exists public.platform_infrastructure_events (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid,
    action text not null check (action ~ '^[a-z_.]{3,80}$'),
    details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
    created_at timestamptz not null default now()
);

create index if not exists idx_platform_infrastructure_events_created
    on public.platform_infrastructure_events(created_at desc);

alter table public.platform_integrations enable row level security;
alter table public.platform_webhook_endpoints enable row level security;
alter table public.platform_infrastructure_events enable row level security;

revoke all on public.platform_integrations, public.platform_webhook_endpoints, public.platform_infrastructure_events
    from public, anon, authenticated;
grant select, insert, update on public.platform_integrations, public.platform_webhook_endpoints to service_role;
grant select, insert on public.platform_infrastructure_events to service_role;

-- Audit rows are append-only.
create or replace function public.platform_infrastructure_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'platform infrastructure events are append-only';
end;
$$;

drop trigger if exists platform_infrastructure_events_append_only on public.platform_infrastructure_events;
create trigger platform_infrastructure_events_append_only
    before update or delete on public.platform_infrastructure_events
    for each row execute function public.platform_infrastructure_events_append_only();

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
    if p_provider not in ('cloudflare') then
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

create or replace function public.get_platform_integration_credentials(p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_payload jsonb;
begin
    select ds.decrypted_secret::jsonb into v_payload
    from public.platform_integrations as pi
    join vault.decrypted_secrets as ds on ds.id = pi.credential_secret_id
    where pi.provider = p_provider;
    return v_payload;
end;
$$;

revoke all on function public.set_platform_integration_credentials(text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.get_platform_integration_credentials(text) from public, anon, authenticated;
revoke all on function public.platform_infrastructure_events_append_only() from public, anon, authenticated;
grant execute on function public.set_platform_integration_credentials(text, jsonb, jsonb, uuid) to service_role;
grant execute on function public.get_platform_integration_credentials(text) to service_role;
