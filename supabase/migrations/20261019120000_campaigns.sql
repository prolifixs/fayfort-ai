-- Campaigns (docs/CATALOG_MERCHANDISING_PLAN.md §6): giveaways and flash sales get a "Prepare a campaign" task for
-- the Store team before they start, and giveaways keep their results once they wrap up. A store product given as a
-- prize is held back from what members see as available until the giveaway wraps up.

create table if not exists public.merch_campaign_preps (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('giveaway', 'sale')),
    source_id uuid not null,
    prize_ready_at timestamptz,
    section_ready_at timestamptz,
    announcement text check (announcement is null or length(announcement) <= 2000),
    announcement_at timestamptz,
    ready_at timestamptz,
    ready_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (kind, source_id)
);

alter table public.merch_campaign_preps enable row level security;
revoke all on table public.merch_campaign_preps from public, anon, authenticated;
grant select, insert, update, delete on table public.merch_campaign_preps to service_role;

alter table public.commerce_giveaways
    add column if not exists results jsonb,
    add column if not exists wrapped_up_at timestamptz;
alter table public.commerce_giveaways
    drop constraint if exists commerce_giveaway_results_object;
alter table public.commerce_giveaways
    add constraint commerce_giveaway_results_object check (results is null or jsonb_typeof(results) = 'object');

comment on table public.merch_campaign_preps is
    'Store team preparation for a giveaway or flash sale: prize ready, section ready, announcement drafted. Service role only.';
