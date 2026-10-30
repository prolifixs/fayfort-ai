-- FayFort Finds: the "Email me when it opens" bell on Home (docs/FINDS_PLAN.md).
-- Empty means the member hasn't chosen: paid plans get the drop email and Free does not.
-- Safe to run again.
alter table public.member_profiles add column if not exists finds_drop_alerts boolean;
comment on column public.member_profiles.finds_drop_alerts is
    'Email when a Finds drop opens for this member. Null: on for Standard and Pro, off for Free.';
