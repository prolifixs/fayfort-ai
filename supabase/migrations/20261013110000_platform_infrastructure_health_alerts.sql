-- Platform consolidation plan, Gate 3: alert platform admins when a tunnel, Cloudflare access or a
-- webhook endpoint changes health. One idempotent inbox notice per admin per state change.

alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in (
        'assigned', 'reassigned', 'member_replied', 'mentioned',
        'work_due', 'work_overdue', 'automation_failed', 'infrastructure_alert'
    ));

create table if not exists public.platform_infrastructure_health (
    check_key text primary key check (check_key ~ '^(cloudflare|tunnel|webhook):[a-z0-9-]{1,80}$'),
    label text not null check (char_length(label) between 1 and 120),
    healthy boolean not null,
    detail text check (detail is null or char_length(detail) <= 500),
    changed_at timestamptz not null default now(),
    checked_at timestamptz not null default now()
);

alter table public.platform_infrastructure_health enable row level security;
revoke all on public.platform_infrastructure_health from public, anon, authenticated;
grant select on public.platform_infrastructure_health to service_role;

-- Records one health observation. Returns true when an admin alert was raised: the first observation
-- is unhealthy, or the state changed (down -> recovered, or healthy -> down).
create or replace function public.record_platform_infrastructure_health(
    p_check_key text,
    p_label text,
    p_healthy boolean,
    p_detail text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_previous boolean;
    v_found boolean;
    v_changed_at timestamptz := now();
    v_alert boolean := false;
begin
    select h.healthy into v_previous
      from public.platform_infrastructure_health as h
     where h.check_key = p_check_key
     for update;
    v_found := found;

    if not v_found then
        insert into public.platform_infrastructure_health(check_key, label, healthy, detail, changed_at, checked_at)
        values (p_check_key, left(p_label, 120), p_healthy, left(p_detail, 500), v_changed_at, v_changed_at);
        v_alert := not p_healthy;
    elsif v_previous is distinct from p_healthy then
        update public.platform_infrastructure_health
           set label = left(p_label, 120), healthy = p_healthy, detail = left(p_detail, 500),
               changed_at = v_changed_at, checked_at = v_changed_at
         where check_key = p_check_key;
        v_alert := true;
    else
        update public.platform_infrastructure_health
           set label = left(p_label, 120), detail = left(p_detail, 500), checked_at = v_changed_at
         where check_key = p_check_key;
    end if;

    if v_alert then
        insert into public.operations_worker_notifications(
            worker_id, work_item_id, notification_type, title, body, href, dedupe_key
        )
        select users.id,
               null,
               'infrastructure_alert',
               case when p_healthy then 'Infrastructure recovered: ' else 'Infrastructure problem: ' end || left(p_label, 120),
               left(coalesce(p_detail, case when p_healthy then 'Back to normal.' else 'Check the Infrastructure page.' end), 500),
               '/operations?infrastructure=' || split_part(p_check_key, ':', 1),
               'infrastructure:' || p_check_key || ':' || v_changed_at::text || ':' || users.id::text
          from auth.users as users
         where users.raw_app_meta_data ->> 'platform_admin' = 'true'
            or coalesce(users.raw_app_meta_data -> 'roles', '[]'::jsonb) @> '["platform_admin"]'::jsonb
        on conflict (dedupe_key) do nothing;
    end if;
    return v_alert;
end;
$$;

revoke all on function public.record_platform_infrastructure_health(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_platform_infrastructure_health(text, text, boolean, text) to service_role;

comment on function public.record_platform_infrastructure_health(text, text, boolean, text) is
    'Service-role-only health ledger for Cloudflare, tunnels and webhooks; alerts every platform admin once per state change.';
