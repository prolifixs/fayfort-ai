-- Escalate due Operations work and failed automations into the existing
-- private staff inbox. All generated notices are idempotent.

alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in (
        'assigned', 'reassigned', 'member_replied', 'mentioned',
        'work_due', 'work_overdue', 'automation_failed'
    ));

create or replace function public.notify_operations_due_work()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_inserted integer := 0;
begin
    if session_user <> 'postgres' then
        raise exception 'database_scheduler_required' using errcode = '42501';
    end if;

    with due_work as (
        select work.id, work.department, work.summary, work.due_at,
               case when work.due_at <= now() - interval '24 hours'
                    then 'work_overdue' else 'work_due' end as notice_type
          from public.operations_work_items as work
         where work.status in ('open', 'claimed', 'waiting', 'blocked')
           and work.due_at is not null
           and work.due_at <= now()
    ), recipients as (
        -- Assigned work goes only to its current owner. Unassigned work is
        -- visible to active coworkers who can claim that department.
        select due_work.*, worker.user_id
          from due_work
          join public.fayfort_workers as worker
            on worker.status = 'active'
           and (worker.user_id = (
                select work.assigned_worker_id
                  from public.operations_work_items as work
                 where work.id = due_work.id
           ) or (
                not exists (
                    select 1 from public.operations_work_items as assigned
                     where assigned.id = due_work.id
                       and assigned.assigned_worker_id is not null
                ) and exists (
                    select 1 from public.operations_worker_departments as access
                     where access.worker_id = worker.user_id
                       and access.department = due_work.department
                       and access.can_claim
                )
           ))
    ), inserted as (
        insert into public.operations_worker_notifications(
            worker_id, work_item_id, notification_type, title, body, href, dedupe_key
        )
        select recipients.user_id,
               recipients.id,
               recipients.notice_type,
               case recipients.notice_type
                   when 'work_overdue' then 'Work is overdue'
                   else 'Work is due'
               end,
               left(recipients.summary || ' · Due ' ||
                    to_char(recipients.due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), 500),
               '/operations?workItem=' || recipients.id::text,
               recipients.notice_type || ':' || recipients.id::text || ':' ||
                   recipients.due_at::text || ':' || recipients.user_id::text
          from recipients
        on conflict (dedupe_key) do nothing
        returning 1
    )
    select count(*) into v_inserted from inserted;
    return v_inserted;
end;
$$;

revoke all on function public.notify_operations_due_work() from public, anon, authenticated, service_role;

select cron.schedule(
    'departmental-flow-due-notifications',
    '* * * * *',
    'select public.notify_operations_due_work();'
);

create or replace function public.notify_operations_automation_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text;
begin
    if new.status <> 'failed' then
        return new;
    end if;
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then
        return new;
    end if;

    select automation.name into v_name
      from public.business_automations as automation
     where automation.id = new.automation_id;

    insert into public.operations_worker_notifications(
        worker_id, work_item_id, notification_type, title, body, href, dedupe_key
    )
    select users.id,
           null,
           'automation_failed',
           'Automation run failed',
           left(coalesce(v_name, 'Automation') || ' · ' ||
                coalesce(new.error_code, 'failed_run'), 500),
           '/operations?automationRun=' || new.id::text,
           'automation-failed:' || new.id::text || ':' || users.id::text
      from auth.users as users
     where users.raw_app_meta_data ->> 'platform_admin' = 'true'
        or coalesce(users.raw_app_meta_data -> 'roles', '[]'::jsonb) @> '["platform_admin"]'::jsonb
    on conflict (dedupe_key) do nothing;

    return new;
end;
$$;

drop trigger if exists operations_automation_failure_notification on public.automation_executions;
create trigger operations_automation_failure_notification
    after insert or update of status on public.automation_executions
    for each row execute function public.notify_operations_automation_failure();

revoke all on function public.notify_operations_automation_failure() from public, anon, authenticated;
grant execute on function public.notify_operations_automation_failure() to service_role;

comment on function public.notify_operations_due_work() is
    'Postgres-scheduler-only idempotent notifications for assigned due work or unassigned work visible to active department workers.';
comment on function public.notify_operations_automation_failure() is
    'Creates one idempotent private inbox alert for each platform admin when an automation execution fails.';
