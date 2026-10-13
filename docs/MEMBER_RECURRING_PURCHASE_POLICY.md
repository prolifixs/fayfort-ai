# Member recurring request policy — proposed MVP

**Status:** MVP defaults are implemented locally and the schema migration is applied to production. This is not authorization to charge members or place orders. Production schedule use still requires a configured job runner and live acceptance.

## MVP boundary

Treat recurrence as a schedule for creating future sourcing requests, not as permission to purchase or charge automatically. The existing system has no member checkout, payment-provider integration, stored payment method, or recurring order executor. Each occurrence must follow the normal sourcing and quote process; the member must review and explicitly accept the current price and availability, then complete a separately approved payment flow before staff purchases anything. No payment credentials are stored by this feature.

## Recommended defaults

| Decision | Proposed MVP rule |
| --- | --- |
| Cadence | Monthly, quarterly, yearly, or a custom interval of 1–365 days/weeks/months. |
| Time zone | Store an explicit IANA time zone on the schedule. Until member settings provide one, ask the member to select it; do not infer silently from the browser. |
| Calendar anchor | Keep the originally selected local date and time. If a target month lacks that day, run on that month's final day; keep the original anchor for later months (Jan 31 → Feb 28/29 → Mar 31). |
| Daylight saving | Preserve the selected local wall-clock time. For a nonexistent spring-forward time, use the first valid local time after the gap; for an ambiguous fall-back time, use the earlier offset. Persist the resolved UTC instant for every occurrence. |
| First occurrence | The initial request is created immediately as the current request. The member selects a future local date/time for the first repeat. |
| Quantity | Units per occurrence are fixed as entered. A member edit applies only to future occurrences and is recorded in schedule history. |
| Horizon | Limit schedules to 12 occurrences or 12 months, whichever comes first, pending owner review of longer programs. |
| Quote and price | Re-source and quote every occurrence. Require explicit member acceptance for each quote; any changed price or availability requires acceptance. Never charge or purchase based on the previous occurrence's approval. |
| Pause | Takes effect immediately and prevents unclaimed future occurrences from being created. An occurrence already claimed by a worker remains visible and must be completed or explicitly cancelled. |
| Resume | Member chooses a new next date; missed occurrences are skipped, not backfilled. |
| Cancel | Prevent future occurrences immediately. An in-progress sourcing request remains open and is handled through its ordinary cancellation flow. |
| Payment failure | No automated charge/retry in MVP. If payment is later integrated, a failed payment blocks that occurrence and pauses the schedule until the member resolves it. Do not create duplicate orders on retry. |
| Disputes/refunds | Use the normal staff dispute path. The recurrence scheduler does not issue refunds or override a dispute. |
| Notifications | Notify the member when a new occurrence is created, when a quote needs approval, and when a schedule is paused, resumed, cancelled, or reaches its limit. Staff-only notes remain private. |

## Implementation and remaining acceptance work

1. **Local implementation present:** owner-scoped schedule and append-only event tables are drafted in `20261011430000_member_recurring_request_schedules.sql`; activation requires explicit `mvp-v1` acknowledgment and records timezone, anchor, version, next occurrence number, and lifecycle state.
2. **Local implementation present, production pending:** the service-only due-cycle materializer creates future sourcing requests and Operations items, never orders or charges. It is idempotent by `(schedule_id, occurrence_number)`, but no job runner is configured; processing currently requires an explicit platform-admin API call.
3. **Partially implemented:** members can list schedules and pause, resume, or cancel them. Editing future quantity/date, staff visibility, and pause-with-reason controls remain open.
4. **Partially implemented:** each recurring occurrence requires explicit quote acceptance before a `purchase_confirmed` milestone, and requoting clears prior acceptance. Notifications for schedule lifecycle and quote prompts remain open.
5. **Pending:** DST/month-end and concurrency tests, plus separately approved synthetic live acceptance. The production schema, RLS, function privileges, triggers, and ledger were verified; all schedule tables were empty after migration.
6. **Separate future phase:** payment/order execution requires an owner-selected provider, charge timing, consent language, retry/refund rules, and reconciliation process. It remains out of scope here.

## Approval checklist

Before implementation, the owner should approve or amend: explicit time-zone selection, the Jan-31 month-end rule, the 12-occurrence/12-month cap, per-occurrence quote acceptance, no automatic payment, immediate pause/cancel behavior, and skipping rather than backfilling missed cycles. Payment-provider and order automation decisions remain a separate gate.
