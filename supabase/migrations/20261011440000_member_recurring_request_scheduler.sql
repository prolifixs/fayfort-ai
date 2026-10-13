-- Run due recurring sourcing cycles automatically in Supabase Postgres.
-- This only materializes future sourcing requests; it never orders or charges.

create extension if not exists pg_cron;

create or replace function public.run_due_member_request_schedule_job()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_created integer;
begin
    -- pg_cron executes SQL using the role that created the job. The scheduled
    -- job is installed by the database owner; API roles cannot invoke wrapper.
    if session_user <> 'postgres' then
        raise exception 'database_scheduler_required' using errcode = '42501';
    end if;

    -- Reuse the existing service-role-only materializer without broadening its
    -- execute grants. The claim setting is transaction-local to this job call.
    perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
    select public.materialize_due_member_request_schedules(50) into v_created;
    return v_created;
end;
$$;

revoke all on function public.run_due_member_request_schedule_job() from public, anon, authenticated, service_role;

-- A stable job name makes re-applying this statement update the existing job
-- instead of creating a duplicate. Runs in UTC once per minute. The materializer
-- locks due schedules with SKIP LOCKED, so manual recovery and cron can coexist.
select cron.schedule(
    'member-recurring-request-due',
    '* * * * *',
    'select public.run_due_member_request_schedule_job();'
);

-- pg_cron retains each run unless explicitly cleaned up. Keep one month of
-- history for this job so failures remain diagnosable without unbounded growth.
select cron.schedule(
    'member-recurring-request-cron-history-cleanup',
    '23 3 * * 0',
    'delete from cron.job_run_details where jobid in (select jobid from cron.job where jobname = ''member-recurring-request-due'' and username = ''postgres'') and end_time < now() - interval ''30 days'';'
);

comment on function public.run_due_member_request_schedule_job() is
    'Owner-only pg_cron wrapper for recurring sourcing request materialization; no orders or charges are created.';
