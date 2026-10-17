-- Instagram posts and reels shown on www.fayfort.com (docs/PUBLIC_SITE_REBUILD_PLAN.md, owner decision 7).
-- Staff paste a post or reel link in Control Center → Website; the public site shows the active ones in order.

create table if not exists public.site_instagram_posts (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('p', 'reel')),
    shortcode text not null check (shortcode ~ '^[A-Za-z0-9_-]{5,40}$'),
    label text check (label is null or length(label) <= 80),
    active boolean not null default true,
    sort_order integer not null default 0,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (kind, shortcode)
);
create index if not exists idx_site_instagram_posts_order on public.site_instagram_posts(active, sort_order, created_at);

alter table public.site_instagram_posts enable row level security;
revoke all on table public.site_instagram_posts from public, anon, authenticated;
grant select, insert, update, delete on table public.site_instagram_posts to service_role;
