-- Prevent the backend service role from bypassing row-level append-only
-- enforcement through TRUNCATE, which does not fire row triggers.
revoke truncate on table public.member_request_events from service_role;
