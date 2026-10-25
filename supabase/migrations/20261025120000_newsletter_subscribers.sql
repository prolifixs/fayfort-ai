-- Newsletter for visitors who aren't members (owner request, 2026-10-25). They subscribe on fayfort.com or in the
-- catalog, confirm by email (double opt-in), and get the same newsletter members get. Safe to run again.
create table if not exists public.newsletter_subscribers (
    id uuid primary key default gen_random_uuid(),
    email text not null unique check (email = lower(email) and length(email) between 3 and 320),
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
    source text not null default 'site' check (source in ('site_footer', 'site_popup', 'go', 'catalog_popup', 'newsletter_page', 'site')),
    confirm_token uuid not null default gen_random_uuid() unique,
    unsubscribe_token uuid not null default gen_random_uuid() unique,
    confirm_sent_at timestamptz,
    confirmed_at timestamptz,
    unsubscribed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_newsletter_subscribers_status on public.newsletter_subscribers(status);

alter table public.newsletter_subscribers enable row level security;
revoke all on table public.newsletter_subscribers from public, anon, authenticated;
grant select, insert, update, delete on table public.newsletter_subscribers to service_role;
