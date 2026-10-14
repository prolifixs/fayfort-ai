-- Workforce accounts: invitation lifecycle, activation/deactivation timestamps, an append-only
-- workforce audit ledger, sign-in history for platform admins, and safe release of a
-- deactivated worker's assignments back to the Operations queue.

alter table public.fayfort_workers
    add column if not exists invitation_sent_at timestamptz,
    add column if not exists invitation_count integer not null default 1,
    add column if not exists activated_at timestamptz,
    add column if not exists deactivated_at timestamptz,
    add column if not exists deactivated_by uuid references auth.users(id) on delete set null;

alter table public.fayfort_workers drop constraint if exists fayfort_workers_invitation_count_check;
alter table public.fayfort_workers add constraint fayfort_workers_invitation_count_check
    check (invitation_count between 1 and 50);
alter table public.fayfort_workers drop constraint if exists fayfort_workers_deactivation_state_check;
alter table public.fayfort_workers add constraint fayfort_workers_deactivation_state_check
    check ((status = 'inactive') = (deactivated_at is not null));

-- Backfill from what is already known: invitations were sent when the row was created,
-- and active workers were activated no later than their last update.
update public.fayfort_workers set invitation_sent_at = created_at where invitation_sent_at is null;
update public.fayfort_workers set activated_at = updated_at where status = 'active' and activated_at is null;
update public.fayfort_workers set deactivated_at = updated_at where status = 'inactive' and deactivated_at is null;

alter table public.fayfort_workers alter column invitation_sent_at set default now();
alter table public.fayfort_workers alter column invitation_sent_at set not null;

-- Activation after email confirmation now also records when it happened.
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
      and status = 'invited';
    return new;
end;
$$;
revoke all on function public.activate_invited_worker_after_email_confirmation() from public, anon, authenticated;

-- Append-only workforce audit ledger. Only the API (service role) writes it.
create table if not exists public.workforce_audit (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references auth.users(id) on delete set null,
    target_id uuid references auth.users(id) on delete set null,
    target_email text check (target_email is null or length(target_email) <= 320),
    action text not null check (action in (
        'invited', 'invitation_resent', 'invitation_revoked', 'activated', 'deactivated', 'reactivated',
        'password_reset_sent', 'mfa_reset', 'assignments_released'
    )),
    detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
    created_at timestamptz not null default now()
);
create index if not exists idx_workforce_audit_target on public.workforce_audit(target_id, created_at desc);
create index if not exists idx_workforce_audit_created on public.workforce_audit(created_at desc);

alter table public.workforce_audit enable row level security;
revoke all on table public.workforce_audit from public, anon, authenticated;
grant select, insert on table public.workforce_audit to service_role;

create or replace function public.prevent_workforce_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'workforce_audit is append-only';
end;
$$;
drop trigger if exists workforce_audit_append_only on public.workforce_audit;
create trigger workforce_audit_append_only
    before update or delete on public.workforce_audit
    for each row execute function public.prevent_workforce_audit_mutation();
revoke all on function public.prevent_workforce_audit_mutation() from public, anon, authenticated;

comment on table public.workforce_audit is
    'Append-only record of platform-admin actions on FayFort worker accounts (invite, deactivate, resets).';

-- Sign-in and account events for one identity, read from Supabase Auth's own audit log.
-- Service role only; the API restricts it to platform admins.
create or replace function public.workforce_auth_events(p_user_id uuid, p_limit integer default 25)
returns table(event_action text, ip_address text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select entry.payload ->> 'action', entry.ip_address::text, entry.created_at
      from auth.audit_log_entries entry
     where entry.payload ->> 'actor_id' = p_user_id::text
       and entry.payload ->> 'action' in (
           'login', 'logout', 'token_revoked', 'user_recovery_requested', 'user_updated_password',
           'user_invited', 'user_signedup', 'user_confirmation_requested', 'user_modified',
           'factor_in_progress', 'factor_unenrolled', 'challenge_created', 'verification_attempted',
           'factor_deleted', 'user_reauthenticate_requested'
       )
     order by entry.created_at desc
     limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;
revoke all on function public.workforce_auth_events(uuid, integer) from public, anon, authenticated;
grant execute on function public.workforce_auth_events(uuid, integer) to service_role;

-- Return everything a worker holds to the queue: business handoffs go back to "requested"
-- (the existing sync trigger reopens their work items), member-request assignments are cleared
-- (their sync trigger updates the work items), and any other open work item is released.
create or replace function public.release_workforce_assignments(p_worker_id uuid, p_actor_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_handoffs integer := 0;
    v_requests integer := 0;
    v_items integer := 0;
    v_item public.operations_work_items%rowtype;
    v_sequence bigint;
begin
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'release reason is required'; end if;

    -- Lock order: handoffs first, then work items (matches the handoff sync trigger).
    update public.conversation_handoffs
       set assigned_to = null, status = 'requested'
     where assigned_to = p_worker_id and status in ('assigned', 'active');
    get diagnostics v_handoffs = row_count;

    update public.member_purchase_requests request
       set assigned_worker_id = null
     where request.assigned_worker_id = p_worker_id
       and exists (
           select 1 from public.operations_work_items work
            where work.member_request_id = request.id and work.status not in ('completed', 'cancelled'));
    get diagnostics v_requests = row_count;

    for v_item in
        select * from public.operations_work_items
         where assigned_worker_id = p_worker_id and status not in ('completed', 'cancelled')
         for update
    loop
        update public.operations_work_items
           set status = 'open', assigned_worker_id = null, claimed_until = null,
               waiting_on = null, waiting_reason = null, version = version + 1, updated_at = now()
         where id = v_item.id;
        select coalesce(max(sequence_no), 0) + 1 into v_sequence
          from public.operations_work_events where work_item_id = v_item.id;
        insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type,
            actor_user_id, previous_department, next_department, previous_status, next_status, reason)
        values (v_item.id, v_sequence, 'released', 'platform_admin', p_actor_id,
            v_item.department, v_item.department, v_item.status, 'open', btrim(p_reason));
        v_items := v_items + 1;
    end loop;

    delete from public.operations_worker_presence where worker_id = p_worker_id;

    return jsonb_build_object('handoffs', v_handoffs, 'member_requests', v_requests, 'work_items', v_items);
end;
$$;
revoke all on function public.release_workforce_assignments(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_workforce_assignments(uuid, uuid, text) to service_role;
