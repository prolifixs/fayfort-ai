-- Preserve completion state for post-response automation and provider delivery.
-- Existing processed events remain complete/not-required; only new inbound
-- events enter reconciliation when the inbound pipeline records them.
alter table public.channel_events
    add column if not exists approved_reply_automation_id uuid,
    add column if not exists automation_status text not null default 'complete',
    add column if not exists automation_last_error_code text,
    add column if not exists automation_completed_at timestamptz,
    add column if not exists delivery_status text not null default 'not_required',
    add column if not exists delivery_safe_error_code text;

alter table public.channel_events drop constraint if exists channel_events_automation_status_check;
alter table public.channel_events add constraint channel_events_automation_status_check
    check (automation_status in ('pending', 'complete'));
alter table public.channel_events drop constraint if exists channel_events_delivery_status_check;
alter table public.channel_events add constraint channel_events_delivery_status_check
    check (delivery_status in ('not_required', 'pending', 'sending', 'sent', 'rejected', 'unknown', 'blocked'));

create index if not exists idx_channel_events_pending_reconciliation
    on public.channel_events(processed_at, id)
    where status = 'processed' and (automation_status = 'pending' or delivery_status = 'pending');

comment on column public.channel_events.approved_reply_automation_id is 'Matched internal automation for the already-saved response; never causes provider delivery during reconciliation.';
comment on column public.channel_events.automation_status is 'Idempotent inbound automation execution ledger state, separate from message acceptance.';
comment on column public.channel_events.delivery_status is 'Projection of the response message delivery ledger; reconciler never resends provider messages.';
