alter table public.business_connections
    add column if not exists health_checked_at timestamptz,
    add column if not exists health_error_code text;

alter table public.business_connections
    drop constraint if exists business_connections_health_error_code_check;

alter table public.business_connections
    add constraint business_connections_health_error_code_check
    check (health_error_code is null or health_error_code in (
        'meta_unreachable',
        'token_rejected',
        'profile_incomplete',
        'subscription_rejected',
        'subscription_response_invalid',
        'subscription_unconfirmed',
        'profile_persistence_failed'
    ));
