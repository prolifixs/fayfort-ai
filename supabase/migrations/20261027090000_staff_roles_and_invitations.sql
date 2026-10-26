-- Staff roles and staff invitations for existing accounts (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md sections 3 and 8).
-- * Every worker has a role: staff (default), assistant or ceo. Only one CEO (invited or active) at a time.
-- * An administrator can make an existing account (for example a member) staff: a link is emailed, and the person
--   accepts it while signed in. Departments chosen at invitation are applied when the account becomes active.
-- Safe to run again.

-- 1. Role, title and invitation details.
alter table public.fayfort_workers
    add column if not exists staff_role text not null default 'staff',
    add column if not exists job_title text,
    add column if not exists invite_kind text not null default 'new_account',
    add column if not exists invite_token_hash text,
    add column if not exists invite_expires_at timestamptz,
    add column if not exists pending_departments text[] not null default '{}';

alter table public.fayfort_workers drop constraint if exists fayfort_workers_staff_role_check;
alter table public.fayfort_workers add constraint fayfort_workers_staff_role_check
    check (staff_role in ('staff', 'assistant', 'ceo'));
alter table public.fayfort_workers drop constraint if exists fayfort_workers_job_title_check;
alter table public.fayfort_workers add constraint fayfort_workers_job_title_check
    check (job_title is null or length(btrim(job_title)) between 1 and 80);
alter table public.fayfort_workers drop constraint if exists fayfort_workers_invite_kind_check;
alter table public.fayfort_workers add constraint fayfort_workers_invite_kind_check
    check (invite_kind in ('new_account', 'existing_account'));
alter table public.fayfort_workers drop constraint if exists fayfort_workers_invite_token_hash_check;
alter table public.fayfort_workers add constraint fayfort_workers_invite_token_hash_check
    check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$');
alter table public.fayfort_workers drop constraint if exists fayfort_workers_pending_departments_check;
alter table public.fayfort_workers add constraint fayfort_workers_pending_departments_check
    check (pending_departments <@ array['conversation_intake', 'sourcing', 'fulfillment', 'disputes',
                                        'member_support', 'store_team']::text[]);

-- Only one CEO, counting a pending invitation.
create unique index if not exists uq_fayfort_workers_one_ceo
    on public.fayfort_workers ((staff_role)) where staff_role = 'ceo' and status <> 'inactive';
create unique index if not exists uq_fayfort_workers_invite_token
    on public.fayfort_workers (invite_token_hash) where invite_token_hash is not null;

comment on column public.fayfort_workers.staff_role is
    'staff, assistant (manages the CEO''s calendar and bookings) or ceo (only one). Departments still decide Operations access.';
comment on column public.fayfort_workers.invite_kind is
    'new_account: Supabase invitation email, activated by email confirmation. existing_account: FayFort link, accepted while signed in.';

-- 2. Audit actions for the new steps.
alter table public.workforce_audit drop constraint if exists workforce_audit_action_check;
alter table public.workforce_audit add constraint workforce_audit_action_check check (action in (
    'invited', 'invitation_resent', 'invitation_revoked', 'activated', 'deactivated', 'reactivated',
    'password_reset_sent', 'mfa_reset', 'assignments_released', 'role_changed', 'invitation_accepted'
));

-- 3. Departments chosen at invitation are applied when the account becomes active.
create or replace function public.apply_pending_worker_departments(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_worker public.fayfort_workers%rowtype;
begin
    select * into v_worker from public.fayfort_workers where user_id = p_worker_id;
    if not found or v_worker.status <> 'active' or coalesce(array_length(v_worker.pending_departments, 1), 0) = 0 then
        return;
    end if;
    perform public.set_operations_worker_departments(v_worker.provisioned_by, p_worker_id, v_worker.pending_departments);
    update public.fayfort_workers set pending_departments = '{}' where user_id = p_worker_id;
end;
$$;
revoke all on function public.apply_pending_worker_departments(uuid) from public, anon, authenticated;
grant execute on function public.apply_pending_worker_departments(uuid) to service_role;

-- New accounts: activation after email confirmation (as before) now also applies the chosen departments.
create or replace function public.activate_invited_worker_after_email_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.fayfort_workers
    set status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
    where user_id = new.id
      and status = 'invited'
      and invite_kind = 'new_account';
    if found then
        perform public.apply_pending_worker_departments(new.id);
    end if;
    return new;
end;
$$;
revoke all on function public.activate_invited_worker_after_email_confirmation() from public, anon, authenticated;

-- 4. Existing accounts accept with the emailed link while signed in as that account.
create or replace function public.accept_staff_invitation(p_user_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_worker public.fayfort_workers%rowtype;
begin
    select * into v_worker from public.fayfort_workers
     where invite_token_hash = p_token_hash and invite_kind = 'existing_account'
     for update;
    if not found then
        raise exception 'invitation_not_found';
    end if;
    if v_worker.user_id <> p_user_id then
        raise exception 'invitation_other_account';
    end if;
    if v_worker.status <> 'invited' then
        raise exception 'invitation_not_found';
    end if;
    if v_worker.invite_expires_at is null or v_worker.invite_expires_at <= now() then
        raise exception 'invitation_expired';
    end if;
    if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
        raise exception 'email_not_confirmed';
    end if;
    update public.fayfort_workers
       set status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now(),
           invite_token_hash = null, invite_expires_at = null
     where user_id = p_user_id;
    perform public.apply_pending_worker_departments(p_user_id);
    return jsonb_build_object('user_id', p_user_id, 'staff_role', v_worker.staff_role, 'job_title', v_worker.job_title,
                              'provisioned_by', v_worker.provisioned_by);
end;
$$;
revoke all on function public.accept_staff_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.accept_staff_invitation(uuid, text) to service_role;

-- 5. Search existing accounts to make staff (administrators only, through the API).
create or replace function public.search_accounts_for_staff(p_query text, p_limit integer default 10)
returns table(user_id uuid, email text, display_name text, username text, created_at timestamptz,
              last_sign_in_at timestamptz, email_confirmed boolean, banned boolean, staff_status text, staff_role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_query text := lower(btrim(coalesce(p_query, '')));
    v_like text;
begin
    if length(v_query) < 3 then
        return;
    end if;
    v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    return query
    select u.id, lower(u.email)::text, profile.display_name::text, profile.username::text, u.created_at,
           u.last_sign_in_at, u.email_confirmed_at is not null, coalesce(u.banned_until > now(), false),
           worker.status::text, worker.staff_role::text
      from auth.users u
      left join public.member_profiles profile on profile.user_id = u.id
      left join public.fayfort_workers worker on worker.user_id = u.id
     where u.email is not null
       and (lower(u.email) like v_like
            or lower(coalesce(profile.display_name, '')) like v_like
            or lower(coalesce(profile.username, '')) like v_like)
     order by (lower(u.email) = v_query) desc, u.last_sign_in_at desc nulls last, u.created_at desc
     limit least(greatest(coalesce(p_limit, 10), 1), 25);
end;
$$;
revoke all on function public.search_accounts_for_staff(text, integer) from public, anon, authenticated;
grant execute on function public.search_accounts_for_staff(text, integer) to service_role;
