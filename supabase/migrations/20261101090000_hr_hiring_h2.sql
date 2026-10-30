-- HR and hiring H2: private status links that can be re-sent (docs/HR_AND_HIRING_PLAN.md).
-- Each email to a candidate carries a fresh link; every link the candidate has been sent keeps working until their
-- details are deleted. Only SHA-256 hashes of the tokens are stored. Safe to run again.

create table if not exists public.hr_status_links (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.hr_applications(id) on delete cascade,
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now()
);
create index if not exists idx_hr_status_links_application on public.hr_status_links(application_id);

-- Links sent with H1 applications.
insert into public.hr_status_links(application_id, token_hash)
select id, token_hash from public.hr_applications where token_hash is not null
on conflict (token_hash) do nothing;

alter table public.hr_status_links enable row level security;
revoke all on table public.hr_status_links from anon, authenticated;
grant select, insert, update, delete on table public.hr_status_links to service_role;
