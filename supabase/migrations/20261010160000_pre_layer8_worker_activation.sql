-- Promote a pre-provisioned FayFort worker only after Supabase confirms email.
-- This grants worker status only; it does not grant platform-admin or business access.

create or replace function public.activate_invited_worker_after_email_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.fayfort_workers
    set status = 'active', updated_at = now()
    where user_id = new.id
      and status = 'invited';
    return new;
end;
$$;

revoke all on function public.activate_invited_worker_after_email_confirmation() from public, anon, authenticated;

drop trigger if exists on_auth_worker_email_confirmed on auth.users;
create trigger on_auth_worker_email_confirmed
    after update of email_confirmed_at on auth.users
    for each row
    when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
    execute function public.activate_invited_worker_after_email_confirmation();

-- Repair only already-confirmed identities that were explicitly provisioned
-- as invited workers. Existing active/inactive rows are not modified.
update public.fayfort_workers as worker
set status = 'active', updated_at = now()
from auth.users as auth_user
where auth_user.id = worker.user_id
  and auth_user.email_confirmed_at is not null
  and worker.status = 'invited';

comment on function public.activate_invited_worker_after_email_confirmation() is
    'Activates an explicitly provisioned FayFort worker after Supabase confirms that identity email.';
