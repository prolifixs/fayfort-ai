-- P8-04: persist a display-only member reward balance.
-- No points are awarded or spent by this migration.

alter table public.member_profiles
    add column if not exists points_balance bigint not null default 0
    check (points_balance >= 0);

comment on column public.member_profiles.points_balance is
    'Placeholder virtual points balance. No award, redemption, or client-side mutation logic is enabled.';

-- Existing member_profiles grants allow a member to update display_name only.
-- Keep points_balance and rank fields server-managed.
