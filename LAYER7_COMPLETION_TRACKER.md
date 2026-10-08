# Layer 7 Completion Tracker

Updated: 2026-10-05  
Status: **In progress — not approved for publication**

This tracker is the active Layer 7 backlog and release gate. It measures the core system in the official eight build areas captured in `docs/LAYER7_BUILD_PLAN.md`. Layer 8 production hardening is tracked separately and is not counted in this percentage.

## Current core-system estimate

**Estimated implementation completeness: 61%.** This is a weighted engineering estimate, not a claim that 61% is production-ready. It reflects foundations and partial workflows that exist, while leaving incomplete acceptance criteria open. Scores are rounded at the overall percentage.

| Core area | Weight | Implemented | Weighted points | Current evidence and main gap |
|---|---:|---:|---:|---|
| Permanent dashboard foundation | 15% | 80% | 12.00 | Sign-in, workspace shell, module navigation, APIs and data screens exist. The account’s existing active membership and data loaded again after a clean API restart; a loading/empty-state race was fixed. |
| Normalized channels | 20% | 55% | 11.00 | Manual inbound and a real Instagram DM both traversed normalized inbound processing and persisted. An Instagram send adapter and delivery ledger are now implemented in the working tree, but the migration, dashboard status, and live send acceptance are still unverified, so this score is unchanged. |
| Connections | 10% | 85% | 8.50 | Instagram credentials are vault-backed; account verification, messages subscription and signed real webhook receipt succeeded. Screenshot 1394 confirms the saved connection is connected, has a successful provider-check time and verified username. |
| Automation | 15% | 35% | 5.25 | Disabled definitions, dry runs and test-run records exist. Trigger evaluation, schedules, retries and operational failure recovery are missing. |
| Events and live updates | 10% | 80% | 8.00 | Sanitized persisted events, one-use WebSocket tickets and live Overview activity have worked. Management event/schema migrations are applied and the local/remote migration histories now match; reconnect coverage remains incomplete. |
| Human handoff | 10% | 65% | 6.50 | Request, takeover, reply recording and return-to-automation were exercised. Human reply delivery and complete UI-to-customer closure are missing. |
| Operational dashboard modules | 10% | 60% | 6.00 | All modules render API-backed data; several management actions were added. Full filtering, editing, permissions, audit review and live verification remain open. |
| End-to-end closure and evidence | 10% | 40% | 4.00 | Manual duplicate protection and a real Instagram inbound-to-persistence run passed. Provider outbound delivery, retry evidence and the full current acceptance pass remain open. |
| **Total** | **100%** |  | **61.25 / 100 ≈ 61%** | **Core Layer 7 remains incomplete and must not be published.** |

A work area is not “done” because its page renders or its route returns HTTP 200. It must meet the acceptance criteria below and have current evidence in the test/verification record.

## Publication gate

**Do not publish, deploy, or present Layer 7 as complete while any P0 item is open.** Do not publish an individual module as complete while its own acceptance criteria remain open. A development screen may remain available for internal testing only when it is clearly marked as incomplete and cannot imply unsupported provider connectivity, automation, entitlement or verification behavior.

Layer 7 may be marked publish-ready only after all of these are true:

- Every P0 item below is closed with evidence and reviewer/date recorded.
- The new database migrations are applied and the live schema matches the repository.
- Workspace selection works for the intended account; empty membership is distinguished from loading and transport errors.
- Every published module has complete loading, error, empty, permission, and success states for the workflows it exposes.
- A full inbound → L4 → L5 → L6 → response → outbound provider flow passes, including duplicate delivery and failure/retry behavior.
- Automation schedules/triggers/retries and human reply delivery work as specified, or the official specification is explicitly revised before any scope is removed.
- Authorization, business isolation, event sanitization, audit history, migration/RLS and regression checks pass.
- The completion score is recalculated from closed acceptance criteria; no section is described as finished based only on visual loading.

## Open work register

### P0 — Required before Layer 7 publication

- [x] **L7-001 — Resolve workspace data visibility.** The UI briefly showed “No active business workspaces” while the sidebar still said “Loading.” The owner stopped the API with Ctrl+C and restarted it; the existing FayFort Test Business workspace and Overview loaded again. The screenshot terminal shows Uvicorn `--reload` reacting to `app/dashboard/modules.py` changes and `httpx` request errors during the reload. The dashboard now waits for the business-list request before showing a true empty state and gives account/retry guidance if membership is genuinely absent. No membership data was changed and no cross-tenant fallback was added. Evidence: owner screenshot 1333 after the clean API restart.
- [x] **L7-002 — Reconcile and verify applied migrations.** Owner reports the directory-verification review and management-event SQL migrations succeeded in Supabase SQL Editor. Read-only app checks confirmed the review table is reachable to service role, public-anon SELECT is denied with PostgreSQL `42501`, and all 9 existing `business_events` rows use event types allowed by the migration. Screenshot 1392 confirms RLS is enabled; anon/authenticated SELECT and authenticated INSERT are false; service-role SELECT/INSERT are true; the event-type check constraint exists. The credential-vault migration's account columns and read/write RPCs were also confirmed live (write RPC probe used a nonexistent ID and returned false without storing data). Screenshot 1393 showed no history rows. Ran Supabase CLI `migration repair --status applied` for `20261004120000`, `20261004121000`, and `20261004130000`; subsequent `migration list` confirmed every local migration through `20261004130000` has a matching remote row. The repair changed migration history only and did not rerun SQL.
- [x] **L7-003 — Configure trusted platform-admin identity.** User authorized the current FayFort owner/admin account. Set and verified server-managed Supabase `app_metadata.platform_admin=true` for Auth user `51e48647-6c39-4944-8448-4ee3c0f84f3e` through the Auth Admin API. Do not replace this with a client-settable user-metadata flag.
- [ ] **L7-003a — Verify platform-admin authorization boundaries.** Screenshots 1390–1391 confirm the refreshed owner/admin session sees entitlement grant controls and verification review controls. Code path verifies the bearer token with Supabase and checks server-managed `app_metadata`; GET responses expose `can_manage`/`can_review`, and write routes call the platform-admin guard. Remaining: verify a separate active business admin without the claim is denied. Current business has only one active member/admin, so repeat when a second admin account exists.
- [x] **L7-004 — Complete provider connection lifecycle and health.** Instagram has vault-backed credentials, account verification, confirmed messages subscription, signature validation and a real inbound DM that matched and persisted. Verification now transitions successful active checks to `connected`, records the health-check timestamp, clears stale errors and persists safe error codes/status on failed checks. Screenshot 1394 confirms the live connection is `connected`, shows the successful check time and verified username. The health migration is applied and history matches; dashboard build and backend syntax checks pass. Secrets remain excluded from API responses.
- [ ] **L7-005 — Implement outbound delivery.** In progress: Instagram Login send adapter, per-message delivery ledger/attempt history, conservative duplicate suppression (never blindly replay `unknown`), safe provider error codes, response-window rejection, human reply routing, dashboard opt-in controls, message-level delivery status, and owner/admin retry for explicit provider rejections are implemented. The owner ran the migration in Supabase SQL Editor; a read-only check confirmed the delivery table is available. The dashboard retry control was added and the production build passed on 2026-10-08. Still open: reconcile the Supabase migration ledger after the SQL Editor application, confirm Meta's required messaging permission and token, demonstrate one real human reply delivery and then an opted-in AI auto-reply, prove duplicate/failure/retry behavior, and confirm recorded receipts/status in the dashboard. Outbound and automatic replies remain off by default; the live Instagram connection currently has outbound disabled.
- [ ] **L7-006 — Complete automation runtime.** Implement actual trigger evaluation, schedule execution, idempotency, retry/backoff, cancellation/disable behavior and visible failure/recovery status. Current actions are limited to dry-run/test records. Acceptance: a sandbox rule executes from a supported trigger, records each attempt, avoids duplicate side effects, and can be disabled/recovered through UI/API.
- [ ] **L7-007 — Finish and verify module workflows.** Close the per-module items in the P1 register below. Acceptance: no placeholder or misleading “connected” state remains; all supported controls have business scoping, role checks, audit behavior and working UI-to-API flow.
- [ ] **L7-008 — Run current full acceptance pass.** Add/execute focused backend authorization, data-isolation, migration, lifecycle and UI/browser checks for the new actions, then run the full Layer 7 manual/provider path. Acceptance: test results correspond to the current code, not the 2026-09-29 baseline; failures and screenshots/logs are recorded; all P0s have named closure evidence.

### P1 — Required to close the core implementation

- [ ] **L7-009 — Conversations workflow.** Add status/filter/search and clear pagination or bounded loading; let agents navigate to related customer/request/handoff actions without copying UUIDs. Confirm messages are business-scoped and safe to display.
- [ ] **L7-010 — Customers workflow.** Add usable customer profile/history detail and navigation to conversations/requests. Define editable fields and audit behavior before adding writes; retain field allowlists and business scoping.
- [ ] **L7-011 — Requests workflow.** Current status transitions exist. Add status filters, required/missing-information editing or correction capture, relationship/continuation handling and audit visibility; validate allowed transitions against Layer 5 semantics.
- [ ] **L7-012 — Directory & Tools workflow.** Search UI exists and calls Layer 6. Test every registered tool, no-match, verification-required, premium-without-entitlement, premium-with-entitlement, human-review and audit-failure outcomes. Verify returned fields never exceed the registry projection.
- [ ] **L7-013 — Connections and Channels workflow.** Instagram inbound and the connected/health lifecycle are confirmed. Outbound and auto-reply opt-in controls now exist in the local dashboard and are guarded by verified Instagram connection state; both remain off by default. Confirm actual permission/send success before treating them as operational; never label setup-required records “connected.” Remaining acceptance is tracked under L7-005 and the per-channel items.
- [ ] **L7-014 — Entitlements workflow.** Grant/revoke UI and API exist behind platform-admin claim. Migrations are applied and history is reconciled; verify expiry, regrant/upsert, revoke, audit, and business isolation. Confirm Layer 6 consumes the same business/tool/access-level grant semantics.
- [ ] **L7-015 — Verification workflow.** Queue and reviewed-record history exist behind platform-admin claim. Audit and event migrations are applied and history is reconciled; verify reason, reviewer identity, source record, before/after status and atomicity. Confirm Layer 6 immediately respects the reviewed status and other businesses cannot write shared data.
- [ ] **L7-016 — Settings workflow.** Business name/description edits exist for owner/admin. Add a settings allowlist only for fields with implemented consumers and documented behavior; test validation, authorization, audit, concurrent updates and UI error states.
- [ ] **L7-017 — Analytics workflow.** Current counts are event-derived. Define operational metric semantics, event coverage, time windows, pagination and empty/error behavior; reconcile counts with source tables before describing analytics as complete.
- [ ] **L7-018 — Human Agents workflow.** Keep the team-wide queue in Human Agents, with conversation selection and source filters; make each conversation's detail view the agent's workspace for reading and replying. Show the active handoff state, elapsed wait timer, FIFO position, assignee and history in the chat. Connect human replies to the outbound adapter and verify automation stays suppressed throughout an active handoff. Initial UI foundation: the conversation detail can request a handoff and show queue position/elapsed time; the Human Agents queue can filter by source. Remaining: assignment/history polish, actual outbound replies, live staffing-aware ETA, and a global new-request notification badge/banner.
- [ ] **L7-018a — Human queue capacity and notification design.** Before Layer 8, define staff availability/shift state and capacity, notification acknowledgement/routing, queue refresh/pagination (current handoff API caps results at 200), and the service-time metric for wait estimates. Keep FIFO ordering; estimate time to first human response using available agents, active workload, operating hours, and observed request-to-first-response/ownership latency. Display a range or “estimate unavailable” when capacity is unknown; do not present a fabricated countdown. Queue position and elapsed wait are the current foundation; ETA is deferred until staffing and service-time data exist.
- [ ] **L7-019 — Live event reliability.** Test reconnect, cursor replay, duplicate event handling, token expiry, business switching and event-stream disable behavior. Make status clear when disconnected; do not silently show stale “Live” data.
- [ ] **L7-020 — Reconcile documentation.** Update `docs/LAYER7_BUILD_PLAN.md` and `PROJECT_STATUS.md` where old snapshots say migrations are unapplied or modules are still placeholders. Keep historical test results dated and distinguish them from current acceptance evidence.

### P2 — Track for Layer 8, not a reason to silently omit core behavior

- [ ] **L7-021 — Production hardening plan.** Deployment/rollback, secrets rotation, webhook rate limits/replay windows, monitoring/alerting, backup/recovery, incident response, data-retention/privacy review and load/concurrency limits. These are Layer 8 concerns but must be planned before production release.

## Closed or partly implemented evidence

- [x] Manual inbound event reaches the existing L4–L6 path, persists an AI response, and duplicate replay returns the original processed result. This proves the manual inbound path only; it does not prove provider delivery.
- [x] The dashboard shell, sign-in, business selector, live event stream, and all named module pages rendered in the owner’s earlier screenshots.
- [x] Business-scoped data views exist for conversations/messages, customers, requests, directory tools, channels, entitlements, verification history, analytics and settings.
- [x] Request state changes, manual entitlement grant/revoke, business identity edits, verification review, and safe inbound connection settings have API/UI implementations; several remain blocked by migrations, platform-admin configuration and current acceptance verification.
- [x] Dashboard production build, Python syntax compilation and `git diff --check` passed for the latest changes. These checks prove compilation, not workflow completion.

- [x] Owner ran the event-type preflight query; it returned zero rows. Owner reports both pending SQL migration scripts completed with “Success. No rows returned.” Remaining migration-ledger reconciliation is tracked under L7-002.

## 2026-10-05 — Instagram inbound milestone and carry-forward

- [x] The owner confirmed a real Instagram DM was received, matched to the connected account, processed once, and appeared as a new `instagram` conversation in both the FayFort dashboard and `public.conversations`.
- [x] Root cause of the account lookup miss was the verification flow saving Meta's `id` field while the real webhook used the professional account `user_id`. Verification now requests `user_id,username` and saves `user_id`; re-verifying corrected the saved account identity.
- [ ] Re-verify the connection lifecycle: the database still showed `status=setup_required` after verification. Ensure successful account verification/subscription advances status correctly and the UI reports actual connection health.
- [ ] Reconcile `20261005110000_layer7_outbound_delivery.sql` in the migration ledger after its SQL Editor application; then exercise Instagram human and AI sends, delivery status, duplicate suppression, explicit-rejection retry and uncertain-outcome safety (L7-005). The adapter/UI foundation and schema are present, but provider-backed acceptance is still open. Do not claim automatic replies are complete until this passes.
- [ ] After stable operation, decide whether to retain or lower the temporary ID-only unmatched-account diagnostic in `app/channels/instagram.py`; it excludes message text and credentials.
- [ ] Layer 8 carry-forward: confirm the replacement secrets the owner reports rotating are active, revoke the exposed values, and keep `.env` contents out of screenshots and source control.
## Review rule

At the end of each build, update task status, evidence, date and the weighted score. Keep unfinished tasks open; do not remove them to make the percentage look higher. A task closes only when its acceptance criteria pass in the current build and are reviewed.


## Enforced release command

Use `npm run release:build` from `dashboard/` for a publish candidate. It runs `release:check` first and fails while any P0 or P1 acceptance item is open. `npm run build` is for internal development and intentionally remains available while work is unfinished. Any deployment pipeline must invoke `release:build`; do not deploy by calling the development build directly.


## Recovery note for API hot reload

When `uvicorn --reload` is serving dashboard requests and WatchFiles detects a Python source change, the worker can be interrupted while the browser is requesting workspace data. In the 2026-10-04 incident this showed as `httpx` request errors and the dashboard temporarily rendered no business. Recovery that restored the workspace: press Ctrl+C in the API terminal once, then start Uvicorn cleanly from the repository root; wait for “Application startup complete,” then refresh the browser. Check `/health` and the business selector before assuming database records were lost. Do not create a duplicate business or membership to work around a reload interruption.
