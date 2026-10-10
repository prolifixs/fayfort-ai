-- Pre-Layer 8: member profiles and separately provisioned FayFort workers.
-- This migration is authored locally only; it has not been applied to Supabase.

create table if not exists public.member_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text check (display_name is null or length(display_name) <= 120),
    rank_level integer not null default 1 check (rank_level between 1 and 5),
    subrank integer not null default 1 check (subrank between 1 and 5),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.fayfort_workers (
    user_id uuid primary key references auth.users(id) on delete cascade,
    status text not null default 'invited' check (status in ('invited', 'active', 'inactive')),
    provisioned_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Create a profile for every Auth identity. This contains no privilege grant;
-- business membership and worker status remain separate relationships.
create or replace function public.create_member_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.member_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_member_profile on auth.users;
create trigger on_auth_user_created_member_profile
    after insert on auth.users
    for each row execute function public.create_member_profile_for_auth_user();

insert into public.member_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.member_profiles enable row level security;
alter table public.fayfort_workers enable row level security;

revoke all on public.member_profiles from anon, authenticated;
grant select on public.member_profiles to authenticated;
grant update (display_name) on public.member_profiles to authenticated;
revoke all on public.fayfort_workers from anon, authenticated;
grant select on public.fayfort_workers to authenticated;

drop policy if exists member_profiles_read_own on public.member_profiles;
create policy member_profiles_read_own on public.member_profiles
    for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists member_profiles_update_own on public.member_profiles;
create policy member_profiles_update_own on public.member_profiles
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists fayfort_workers_read_own on public.fayfort_workers;
create policy fayfort_workers_read_own on public.fayfort_workers
    for select to authenticated using (user_id = (select auth.uid()));

comment on table public.member_profiles is
    'Consumer/member profile and placeholder rank fields. A profile alone grants no business or worker access.';
comment on table public.fayfort_workers is
    'Separate FayFort workforce registry; rows are created only by the platform-admin provisioning API.';
