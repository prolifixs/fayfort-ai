-- Surface durable inbound ledger repair outcomes in the sanitized activity feed.
alter table public.business_events drop constraint if exists business_events_event_type_check;
alter table public.business_events add constraint business_events_event_type_check check (event_type in (
    'channel.inbound.processed','channel.delivery_retried','channel.delivery_reconciled','channel.delivery_reconciliation_issue',
    'connection.created','connection.status_changed',
    'automation.created','automation.enabled_changed','automation.execution_recorded','automation.reconciliation_failed','automation.reconciliation_recovered',
    'handoff.requested','handoff.assigned','handoff.taken_over','handoff.returned_to_automation','handoff.agent_availability_changed',
    'request.status_changed','request.updated','entitlement.granted','entitlement.revoked',
    'directory.verification_reviewed','business.settings_updated','connection.settings_updated'
));
