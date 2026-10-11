-- L8 member plan/theme foundation. Billing is intentionally not enabled here.
-- Free is the default and only currently activatable tier.

alter table public.member_profiles
    add column if not exists member_tier text not null default 'free'
        check (member_tier in ('free', 'standard', 'pro')),
    add column if not exists selected_theme text not null default 'base'
        check (length(selected_theme) between 1 and 80);

-- Tier and theme preference writes must go through the authenticated API.
-- Existing direct member update grant remains display_name only.
revoke update (member_tier, selected_theme) on public.member_profiles from authenticated, anon;

comment on column public.member_profiles.member_tier is
    'Server-managed member plan entitlement: free, standard, or pro. Defaults to free; no billing/checkout is implied.';
comment on column public.member_profiles.selected_theme is
    'Member theme preference. Base is the only available theme until the premium theme catalog launches.';
