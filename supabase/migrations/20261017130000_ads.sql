-- Ads on the member dashboard (docs/ADS_PLAN.md).
--
-- * Free members see ads; Standard and Pro members don't (decided by the API from member_profiles.member_tier).
-- * ad_settings is one row: the master switch, Google AdSense publisher ID and test mode, and the on-screen limit.
-- * ad_placements are the fixed places in the member dashboard where an ad may appear; staff choose per placement
--   whether it shows Google, custom ads, or Google with custom ads as the fallback.
-- * ad_creatives are FayFort's own ads (house ads or partner ads). Four placeholders are seeded.
-- * ad_daily_stats counts impressions and clicks per day, placement and custom ad (Google revenue stays in AdSense).

create table if not exists public.ad_settings (
    id smallint primary key default 1 check (id = 1),
    enabled boolean not null default true,
    google_enabled boolean not null default false,
    google_client text check (google_client is null or google_client ~ '^ca-pub-[0-9]{10,20}$'),
    google_test_mode boolean not null default false,
    max_per_screen smallint not null default 3 check (max_per_screen between 1 and 6),
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);
insert into public.ad_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.ad_placements (
    key text primary key check (key ~ '^[a-z_]{3,40}$'),
    label text not null,
    description text not null default '',
    enabled boolean not null default true,
    source text not null default 'google_then_custom' check (source in ('google', 'custom', 'google_then_custom')),
    google_slot_id text check (google_slot_id is null or google_slot_id ~ '^[0-9]{6,20}$'),
    google_format text not null default 'auto' check (google_format in ('auto', 'fluid', 'rectangle', 'horizontal')),
    google_layout_key text check (google_layout_key is null or google_layout_key ~ '^[-+a-z0-9]{3,40}$'),
    shape text not null default 'banner' check (shape in ('banner', 'feed', 'square')),
    priority smallint not null default 50,
    updated_at timestamptz not null default now()
);

insert into public.ad_placements(key, label, description, enabled, google_format, shape, priority) values
    ('browse_top', 'Browse: top banner', 'Between "What''s moving" and the search filters on Browse.', true, 'horizontal', 'banner', 10),
    ('browse_feed', 'Browse: in the product grid', 'A product-sized card after the 8th and 24th products on Browse.', true, 'fluid', 'feed', 20),
    ('product_detail', 'Product page', 'Under the product description, above "Goes well with".', true, 'horizontal', 'banner', 15),
    ('directory_feed', 'Supplier directory', 'After the 5th result in the supplier directory.', true, 'fluid', 'feed', 25),
    ('chat_welcome', 'New chat welcome', 'On the welcome screen of a new chat, below the trending rails. Never inside a conversation.', true, 'horizontal', 'banner', 30),
    ('sidebar', 'Menu (desktop)', 'Bottom of the left menu on desktop; hidden on phones.', true, 'rectangle', 'square', 60),
    ('saved_footer', 'Saved products', 'Under the saved products when there are 4 or more.', false, 'horizontal', 'banner', 40),
    ('orders_footer', 'Orders & requests', 'At the very bottom of Orders & requests, away from Pay buttons.', false, 'horizontal', 'banner', 50)
on conflict (key) do nothing;

create table if not exists public.ad_creatives (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(btrim(name)) between 1 and 80),
    status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
    advertiser text check (advertiser is null or length(advertiser) <= 80),
    headline text not null check (length(btrim(headline)) between 1 and 80),
    body text check (body is null or length(body) <= 200),
    cta_label text not null default 'Learn more' check (length(btrim(cta_label)) between 1 and 30),
    target_url text not null check (
        target_url ~ '^https://[^\s]+$' or target_url ~ '^/member/[^\s]*$' or target_url in ('action:plans')
    ),
    image_url text check (image_url is null or image_url ~ '^https://[^\s]+$'),
    tone text not null default 'brand' check (tone in ('brand', 'light', 'dark', 'accent')),
    placements text[] not null default '{}',
    weight smallint not null default 1 check (weight between 1 and 100),
    starts_at timestamptz,
    ends_at timestamptz,
    is_placeholder boolean not null default false,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists idx_ad_creatives_status on public.ad_creatives(status);

insert into public.ad_creatives(name, status, advertiser, headline, body, cta_label, target_url, tone, placements, weight, is_placeholder)
select * from (values
    ('Placeholder: go ad-free', 'active', 'FayFort', 'Go ad-free with Standard',
     'Lower sourcing deposits, cheaper consultations and no ads. $19 a month, cancel any time.', 'See plans',
     'action:plans', 'brand', array['browse_top','product_detail','chat_welcome','sidebar','saved_footer','orders_footer','browse_feed'], 3, true),
    ('Placeholder: consultation', 'active', 'FayFort', 'Talk to the FayFort team',
     'Planning a bigger order? Book a consultation about sourcing or doing business in China.', 'Book a consultation',
     'action:plans', 'accent', array['browse_top','product_detail','chat_welcome','browse_feed','directory_feed'], 2, true),
    ('Placeholder: supplier directory', 'active', 'FayFort', 'Find verified suppliers',
     'Markets, factories and service providers in China, with addresses in English and Chinese.', 'Open the directory',
     '/member/chat?panel=directory', 'light', array['browse_top','browse_feed','chat_welcome','sidebar','product_detail'], 2, true),
    ('Placeholder: partner ad', 'draft', 'Partner', 'Your brand here',
     'Reach FayFort members who buy from China. Contact the FayFort team to advertise.', 'Learn more',
     'https://www.fayfort.com', 'dark', array['browse_top','browse_feed','directory_feed'], 1, true)
) as seed(name, status, advertiser, headline, body, cta_label, target_url, tone, placements, weight, is_placeholder)
where not exists (select 1 from public.ad_creatives where is_placeholder);

create table if not exists public.ad_daily_stats (
    day date not null,
    placement_key text not null,
    creative_id uuid references public.ad_creatives(id) on delete cascade,
    source text not null check (source in ('google', 'custom')),
    impressions integer not null default 0,
    clicks integer not null default 0,
    creative_key uuid generated always as (coalesce(creative_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
    primary key (day, placement_key, source, creative_key)
);

-- Adds a batch of impressions and clicks: [{"placement": "...", "creative_id": "..."|null, "source": "...", "kind": "impression"|"click"}].
create or replace function public.record_ad_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    event jsonb;
    counted integer := 0;
begin
    for event in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
        if (event->>'kind') not in ('impression', 'click') or (event->>'source') not in ('google', 'custom') then
            continue;
        end if;
        if not exists (select 1 from public.ad_placements where key = event->>'placement') then
            continue;
        end if;
        if nullif(event->>'creative_id', '') is not null
           and not exists (select 1 from public.ad_creatives where id = (event->>'creative_id')::uuid) then
            continue;
        end if;
        insert into public.ad_daily_stats(day, placement_key, creative_id, source, impressions, clicks)
        values (
            (now() at time zone 'utc')::date,
            event->>'placement',
            nullif(event->>'creative_id', '')::uuid,
            event->>'source',
            case when event->>'kind' = 'impression' then 1 else 0 end,
            case when event->>'kind' = 'click' then 1 else 0 end
        )
        on conflict (day, placement_key, source, creative_key) do update
            set impressions = public.ad_daily_stats.impressions + excluded.impressions,
                clicks = public.ad_daily_stats.clicks + excluded.clicks;
        counted := counted + 1;
    end loop;
    return counted;
end;
$$;

alter table public.ad_settings enable row level security;
alter table public.ad_placements enable row level security;
alter table public.ad_creatives enable row level security;
alter table public.ad_daily_stats enable row level security;
revoke all on table public.ad_settings, public.ad_placements, public.ad_creatives, public.ad_daily_stats
    from public, anon, authenticated;
grant select, insert, update, delete on table public.ad_settings, public.ad_placements, public.ad_creatives,
    public.ad_daily_stats to service_role;
revoke all on function public.record_ad_events(jsonb) from public, anon, authenticated;
grant execute on function public.record_ad_events(jsonb) to service_role;

-- Custom ad images are public (they're shown to members); only the API (service role) uploads them.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('ad-images', 'ad-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
