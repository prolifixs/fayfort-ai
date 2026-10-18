-- Member chat Archive (docs/MEMBER_DASHBOARD_UX_PLAN.md §1).
-- A chat linked to a sourcing request is retained as the record and can't be deleted. It can now be archived:
-- it leaves the member's chat list but is never removed. Members archive a retained chat themselves, or it
-- archives itself 3 days after its request is Delivered or Cancelled. Staff views are unchanged.

alter table public.member_conversations add column if not exists archived_at timestamptz;
alter table public.member_conversations add column if not exists archived_by text;
-- Set when the member moves an archived chat back: it is then never archived automatically again.
alter table public.member_conversations add column if not exists unarchived_at timestamptz;
alter table public.member_conversations drop constraint if exists member_conversations_archived_by_check;
alter table public.member_conversations add constraint member_conversations_archived_by_check
    check ((archived_at is null and archived_by is null)
        or (archived_at is not null and archived_by in ('member', 'auto')));

create index if not exists idx_member_conversations_owner_archive
    on public.member_conversations (member_id, archived_at);

-- Archives the chats of finished requests: the latest request event is delivered or cancelled, at least 3 days ago.
-- Returns how many chats were archived. A chat moved back to the list by the member is not archived again.
create or replace function public.archive_finished_member_chats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    with finished as (
        select chat.id
          from public.member_conversations chat
          join lateral (
              select event.stage, event.created_at
                from public.member_request_events event
               where event.request_id = chat.linked_request_id
               order by event.sequence_no desc
               limit 1
          ) latest on true
         where chat.archived_at is null
           and chat.linked_request_id is not null
           and chat.unarchived_at is null
           and latest.stage in ('delivered', 'cancelled')
           and latest.created_at < now() - interval '3 days'
    )
    update public.member_conversations chat
       set archived_at = now(), archived_by = 'auto'
      from finished
     where chat.id = finished.id;
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

revoke all on function public.archive_finished_member_chats() from public, anon, authenticated;
grant execute on function public.archive_finished_member_chats() to service_role;

-- Hourly, at a quiet minute. A stable job name makes re-applying this update the job instead of duplicating it.
select cron.schedule('member-chat-archive', '17 * * * *', 'select public.archive_finished_member_chats();');
