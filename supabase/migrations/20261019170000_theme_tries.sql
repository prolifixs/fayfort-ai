-- Theme try-ons: 15 seconds each, 3 per member per hour (app/accounts/member_theme_tries.py). Service role only.
create table if not exists public.member_theme_tries (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    theme_id text not null references public.member_themes(theme_id) on delete cascade,
    started_at timestamptz not null default now()
);
create index if not exists idx_member_theme_tries_member on public.member_theme_tries(member_id, started_at desc);
alter table public.member_theme_tries enable row level security;
revoke all on table public.member_theme_tries from public, anon, authenticated;
grant select, insert, delete on table public.member_theme_tries to service_role;
comment on table public.member_theme_tries is 'One row per theme try-on. Members get 3 an hour; each lasts 15 seconds.';
