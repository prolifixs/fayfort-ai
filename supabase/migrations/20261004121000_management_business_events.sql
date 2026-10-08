-- Permit sanitized events emitted by owner/admin management actions.
alter table public.business_events drop constraint if exists business_events_event_type_check;
alter table public.business_events add constraint business_events_event_type_check check (event_type in (
    'channel.inbound.processed','connection.created','connection.status_changed',
    'automation.created','automation.enabled_changed','automation.execution_recorded',
    'handoff.requested','handoff.assigned','handoff.taken_over','handoff.returned_to_automation',
    'request.status_changed','entitlement.granted','entitlement.revoked',
    'directory.verification_reviewed','business.settings_updated','connection.settings_updated'
));
