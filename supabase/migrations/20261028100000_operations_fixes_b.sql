-- Operations fixes, phase B (docs/OPERATIONS_FIXES_PLAN.md): a notice when a member declines a deposit, invoice or
-- tour quote. Safe to run again.
alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in (
        'assigned', 'reassigned', 'member_replied', 'mentioned',
        'work_due', 'work_overdue', 'automation_failed', 'infrastructure_alert',
        'review_needed', 'review_done',
        'member_message', 'new_work', 'payment_received', 'booking', 'tour_booking', 'work_done',
        'quote_declined'
    ));
