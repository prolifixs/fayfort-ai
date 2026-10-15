-- Member ranks and points (docs/MEMBERSHIP_PLAN.md, section 6). The API (app/membership/ranks.py) turns real
-- activity into ledger rows; the status score (rank) counts the last 90 days, the points balance is spendable.

create table if not exists public.member_activity_events (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind in (
        'order', 'sourcing_purchase', 'deposit', 'pool', 'share_buyer', 'consultation', 'giveaway_entry', 'redeem'
    )),
    source_key text not null check (length(source_key) between 1 and 200),
    points integer not null,
    occurred_at timestamptz not null,
    created_at timestamptz not null default now(),
    unique (member_id, kind, source_key)
);
create index if not exists idx_member_activity_member_time
    on public.member_activity_events(member_id, occurred_at desc);

alter table public.member_profiles
    add column if not exists status_score integer not null default 0,
    add column if not exists rank_below_since timestamptz,
    add column if not exists rank_checked_at timestamptz;

-- Ranks shown before this engine were placeholders, not earned: start everyone at rank 1 until it runs.
update public.member_profiles set rank_level = 1, subrank = 1
 where rank_checked_at is null and (rank_level <> 1 or subrank <> 1);

alter table public.member_contact_credits
    drop constraint if exists member_contact_credits_reason_check,
    add constraint member_contact_credits_reason_check
        check (reason in ('purchase', 'unlock', 'adjustment', 'points'));

-- Spend points on a reward (today: contact credits). Serialised per member so a balance can't be spent twice.
create or replace function public.redeem_member_points(p_member_id uuid, p_cost integer, p_credits integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_balance integer;
    v_key text := gen_random_uuid()::text;
begin
    if p_cost < 1 or p_credits < 1 then raise exception 'invalid_reward'; end if;
    perform pg_advisory_xact_lock(hashtextextended('member-points:' || p_member_id::text, 0));
    select coalesce(sum(points), 0) into v_balance from public.member_activity_events where member_id = p_member_id;
    if v_balance < p_cost then raise exception 'not_enough_points'; end if;
    insert into public.member_activity_events(member_id, kind, source_key, points, occurred_at)
    values (p_member_id, 'redeem', v_key, -p_cost, now());
    insert into public.member_contact_credits(member_id, delta, reason)
    values (p_member_id, p_credits, 'points');
    update public.member_profiles set points_balance = greatest(v_balance - p_cost, 0), updated_at = now()
     where user_id = p_member_id;
    return v_balance - p_cost;
end;
$$;

alter table public.member_activity_events enable row level security;
revoke all on table public.member_activity_events from public, anon, authenticated;
grant select, insert, update, delete on table public.member_activity_events to service_role;
revoke all on function public.redeem_member_points(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.redeem_member_points(uuid, integer, integer) to service_role;

comment on table public.member_activity_events is
    'What a member did that counts toward rank and points (orders, sourcing purchases, deposits, pools, shares that '
    'brought buyers, consultations, giveaway entries) plus point redemptions (negative). Written by the API only.';
comment on column public.member_profiles.status_score is
    'Rank score: activity points from the last 90 days. Not spendable (points_balance is).';
comment on column public.member_profiles.rank_below_since is
    'Set when the score falls below the current rank; after 30 days the member drops one subrank (grace period).';
