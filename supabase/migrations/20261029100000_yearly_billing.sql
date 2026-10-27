-- Yearly member plans (owner request 2026-10-26): Standard and Pro can also be paid once a year, at 12 times the
-- monthly price (no discount). A yearly payment counts as 12 paid months for perks, allowances and rank points.
-- Safe to run again.
alter table public.member_subscriptions
    add column if not exists billing_interval text not null default 'month';
alter table public.member_subscriptions
    drop constraint if exists member_subscriptions_billing_interval_check;
alter table public.member_subscriptions
    add constraint member_subscriptions_billing_interval_check check (billing_interval in ('month', 'year'));

alter table public.member_subscription_payments
    add column if not exists months smallint not null default 1;
alter table public.member_subscription_payments
    drop constraint if exists member_subscription_payments_months_check;
alter table public.member_subscription_payments
    add constraint member_subscription_payments_months_check check (months between 1 and 36);

comment on column public.member_subscriptions.billing_interval is 'month or year (Stripe price interval).';
comment on column public.member_subscription_payments.months is 'Paid months this payment covers: 1 monthly, 12 yearly.';
