-- Members' name, surname and username (required before using the member app; app/accounts/member_identity.py).
-- display_name stays, written as "First Last" when these are saved, so staff screens keep working.
alter table public.member_profiles
    add column if not exists first_name text check (first_name is null or length(btrim(first_name)) between 1 and 60),
    add column if not exists last_name text check (last_name is null or length(btrim(last_name)) between 1 and 60),
    add column if not exists username text check (
        username is null or (username ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$' and username !~ '(\.\.|__)')
    );
-- Stored lowercase; one member per username.
create unique index if not exists uq_member_profiles_username on public.member_profiles (lower(username))
    where username is not null;

comment on column public.member_profiles.username is
    'Public handle, lowercase, 3-20 characters; unique. Set with the name and surname on the required profile card.';
