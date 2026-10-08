# FayFort project status and carry-forward notes

Updated: 2026-10-05

## Authoritative roadmap

The owner supplied FayFort_Layer_7_Official_Architecture_and_Build_Specification.docx. Treat it as the current Layer 7 authority. It defines Layer 7 as Channels + Automation + Permanent Dashboard Foundation, with Layers 1–6 marked complete and Layer 8 reserved for security and production hardening.

## Existing system

- Layer 4: validated intent classification and proposed actions; actions do not independently execute external operations.
- Layer 5: durable customer profiles and structured requests, including accumulated information, missing fields, corrections, continuations, related requests, and cancellations.
- Layer 6: curated directory and business-tool access through an allowlisted gateway with verification, identity and entitlement checks, deterministic permitted responses, and access logging.
- Supabase live migration history was confirmed by the owner through 20260929134000; the Layer 7 migrations are applied to the linked project. Earlier migration files are retained under supabase/migrations_legacy; do not put them back into the active chain without reconciling the remote history.

## Layer 7 requirements

Reuse Layers 4–6. FastAPI remains the authenticated control/enforcement layer; Supabase remains durable state; a dashboard controls existing services. Layer 7 must establish provider-neutral channel events/adapters, outbound delivery, connections, automation definitions/executions/scheduling/retries, live events/WebSockets, explicit human handoff, and the permanent dashboard shell/modules.

The dashboard modules specified are Overview, Conversations, Customers, Requests, Directory/Tools, Channels, Connections, Automations, Entitlements, Verification, Human Agents, Analytics, and Settings. Provider secrets and database credentials must not be ordinary dashboard fields. Layer 6 remains the only enforcement point for directory and entitlement policy.

## Current Layer 7 progress

- Human takeover blueprint agreed: the Conversations detail is the agent's chat workspace; Human Agents stays the team queue; Requests remains structured task state. A first UI slice now lets operators request takeover in the selected conversation and displays elapsed wait plus FIFO position, and filters the team queue by channel/source. Human reply delivery remains blocked on L7-005. Still to design/build before Layer 8: staff availability and capacity, measured handling-time policy for honest ETAs, and a live badge/banner linking new requests to the queue. See L7-018/L7-018a in `LAYER7_COMPLETION_TRACKER.md`.

- Added docs/LAYER7_BUILD_PLAN.md and dashboard/ (React + TypeScript + Vite) with permanent module navigation, Supabase password sign-in, signed-in business workspace selection, and API-backed surfaces for the specified modules. Management workflows and end-to-end acceptance remain incomplete as tracked in LAYER7_COMPLETION_TRACKER.md.
- Added an authenticated normalized manual inbound channel reusing Layer 4 intent/action, Layer 5 customer/request state, Layer 6 directory/tool enforcement, and response persistence. Durable channel events suppress duplicate processing.
- Added business-scoped connection CRUD/lifecycle endpoints, non-secret settings allowlists and an Instagram credential vault. Instagram verification, webhook subscription and real signed inbound DM processing work; its record still remains `setup_required` after verification and needs lifecycle/health completion.
- Added automation definitions and idempotent executions, initially disabled and limited to `record_test_run`. Dry runs have no side effect; scheduled triggers, retry workers, and automatic trigger evaluation remain outstanding.
- Added persisted human handoffs with assignment, takeover, return-to-automation, audit history, and human-message recording. Incoming messages bypass AI while a handoff is requested, assigned, or active. External delivery for human messages remains outstanding.
- Added a sanitized durable business event feed and WebSocket endpoint. Browser sockets authenticate with short-lived one-use tickets sent as the first frame; event payloads reject message content and credential-like extra fields. Events are emitted for inbound channel completion, connection changes, automation changes, and handoff transitions.
- Expanded scripts/layer7_cli.py for manual-channel, connections, automations, handoffs, and event-feed operations. Access tokens are read from FAYFORT_ACCESS_TOKEN, not CLI arguments.
- Added an authenticated `GET /dashboard/businesses` endpoint that returns only businesses where the verified Supabase user has an active membership.
- Layer 7 migrations applied to the linked Supabase project: `20260929130000_layer7_channel_events.sql`, `20260929131000_layer7_business_connections.sql`, `20260929132000_layer7_automations.sql`, `20260929133000_layer7_handoffs.sql`, and `20260929134000_layer7_business_events.sql`. The owner confirmed matching local/remote migration history and linked schema lint passed.
- Verification on 2026-09-29: 27 focused Layer 7 backend/CLI/event checks passed; dashboard production build passed; five component UI tests passed; one Chromium browser flow passed (sign-in, business selection, and safe connection setup). Python syntax compilation and `git diff --check` passed. No provider-backed end-to-end delivery has been verified.
- Remaining work: close the P0/P1 acceptance items in LAYER7_COMPLETION_TRACKER.md. Instagram signed inbound is verified; finish its connected/health lifecycle and outbound delivery. Complete automation scheduling/retries/triggers, remaining dashboard workflows and the current full provider-backed acceptance pass.

## Carry-forward requirements

- In the final dashboard stage, provide a manual field-level control to approve unverified directory data. Approval must persist in Supabase and retain reviewer identity/history. It must not bypass Layer 6 gateway policy.
- Subscription plans and billing are not designed. Keep the generic business entitlement integration point; do not invent tiers, prices, or plan rules.
- Test through both UI and CLI at each meaningful build step, then complete inbound → L4 → L5 → L6 → response → outbound end to end.
- Rotate the Supabase service-role key and Hugging Face token that were visible in a shared screenshot; update local .env and never include replacement credentials in source control or chat.
- Recent Layer 6 code correction: successful access audit status is derived from records actually returned; response wording says “Verified directory information” only for verified results. Confirm this through a fresh local/API lookup and audit query.

## Owner-led verification checkpoint (2026-10-04)

- The owner confirmed sign-in and business selection work in the local dashboard. The browser/API CORS preflight issue was fixed in `app/main.py`; the dashboard now fetches the business list successfully.
- In the `FayFort Test Business` workspace (`b16f5070-322f-4e86-a18d-243fa54e75c4`), the owner created a `manual_test` connection named `Customer support`. UI status: `setup_required` / `credentials_not_configured`; API returned 201. This is a setup record, not a live provider connection.
- The owner created the disabled `Manual smoke check` automation and ran its dry-run endpoint; API returned 200. The rule remained disabled. The current page did not visibly show run details in the provided screenshot; inspect run history/API output during cleanup if needed.
- The owner checked Overview activity after the handoff lifecycle; it remained “Waiting for business events.” Root cause confirmed: `dashboard/.env.local` sets `VITE_DASHBOARD_EVENTS_ENABLED=false`, and `dashboard/src/app/App.tsx` uses this flag to disable the event stream. Do not count the activity-feed check as passed. Deferred fix/check: after the remaining manual tests, set the flag to `true`, restart Vite, and verify the WebSocket event stream displays the saved handoff events.
- The owner opened Conversations and found the explicit “Conversations is being connected” placeholder. This is unfinished dashboard functionality, not a failed conversation fetch. The current operator UI cannot browse conversations or obtain an ID for the Human Agents handoff form.
- **Deferred dashboard follow-up (do after current Layer 7 API/UI verification):** implement a business-scoped authenticated conversation list endpoint and connect the Conversations screen to it, including loading, error, empty, list, and detail states. Ensure the selected business scopes every query and test the UI/API path. Then verify the Human Agents workflow can select a conversation without requiring a UUID copied from a separate tool. Do not treat the current placeholder as a passing functional conversation-page test.
- The owner’s read-only `GET /businesses` call returned the FayFort Test Business ID above. Use only this test business for the remaining manual verification records.
- Manual-channel CLI verification: the first synthetic event returned `processed` with an AI response. The duplicate-event replay returned the CLI fallback `API returned a non-JSON response`; idempotency is **not yet verified**. Inspect the API terminal status/traceback before retrying; do not record the duplicate check as passed.

## Owner-led verification and dashboard follow-up (2026-10-05)

- Manual inbound idempotency check passed. Replaying `layer7-manual-event-20261004-01` returned `status=duplicate` and the original event status `processed`, linked to conversation `2722bf50-383a-4283-b769-ab0603db7bd1`.
- Authenticated event-feed read returned seven saved business events, IDs 1–7, including exactly one `channel.inbound.processed` record for the manual event and a `response_message_id`.
- Owner confirmed the Conversations, Requests, Directory & Tools, Channels, Entitlements, Verification, Analytics, and Settings pages all displayed the shared “is being connected” placeholder.
- Replaced that generic fallback with API-backed workspace screens. Added authenticated business-scoped endpoints for Conversations and their messages, Customers, Requests, channel event history, registered Layer 6 tools, business entitlements, verification decision history, analytics from saved business events, and safe workspace identity metadata. The new routes validate active membership before data access.
- The dashboard production build passed and Python source compilation passed after these changes.
- Remaining functional gaps are explicit: Directory & Tools currently lists tool capabilities but has no interactive search form; Channels displays recorded inbound event history but no provider setup/outbound delivery; Verification shows access-decision history but has no field-level approval and reviewer-history workflow; Settings displays read-only workspace details because no safe editable-settings schema exists. Analytics is event-derived, not a full reporting suite. These are follow-up implementation items, not successful control tests.
- The Overview live activity stream remains disabled by `VITE_DASHBOARD_EVENTS_ENABLED=false` in the owner’s local dashboard configuration. It is still a deferred fix/check; the backend event feed itself is confirmed working.


## 2026-10-04 — Dashboard module follow-up

- User confirmed the previously disconnected module pages all load after restarting the Vite app from the `dashboard/` directory. Screenshots show API-backed content in Conversations, Customers, Requests, Directory & Tools, Channels, Entitlements, Verification, Analytics, and Settings; Overview also shows the saved event activity.
- Added an authenticated `POST /businesses/{business_id}/directory/search` route. It checks the signed-in business member, verifies that the selected conversation belongs to the business, then delegates retrieval, entitlement checks, field projection, and access-decision auditing to the existing Layer 6 directory gateway.
- Connected the Directory & Tools page to that route. It lets an operator choose an active tool and an existing conversation, enter a query, and view only the policy-approved fields plus the decision and verification outcome.
- Verification run: `npm run build --prefix dashboard` passed after the UI integration. The Python route had previously passed `python -m compileall -q app`.
- Remaining product gaps: field-level approval and reviewer workflows, editable settings with a defined safe allowlist, provider credential setup and outbound delivery, request lifecycle actions, and entitlement management. The current screens expose the available records and clearly identify where actions are not implemented.


## 2026-10-04 — Dashboard management actions

- Requests now support scoped status transitions: active to awaiting customer, completed, or cancelled; awaiting customer back to active or to completed/cancelled. Terminal states cannot be reopened through this control. Updates publish business activity events.
- Entitlements now support manual grant/revoke by owners and admins, with tool/access level, optional expiry, required reason, and activity events. This is independent of billing; it does not imply payment or a subscription.
- Settings now allow owners/admins to edit the persisted business name and description.
- Verification now has a queue for records marked unknown/unverified/conflicting and owner/admin review actions. Each decision includes a reason, updates the source record, creates a review audit row, and publishes a business event. Apply `supabase/migrations/20261004120000_directory_verification_reviews.sql` before saving verification reviews.
- Channels now includes connection setup records and an inbound-processing toggle. Secret credential storage, provider handshakes/webhooks, and outbound delivery adapters do not exist in this repository; the UI keeps connections in `setup_required` until a real provider adapter can verify them and blocks enabling outbound or automatic replies.
- Verification run: dashboard production build passed, API sources compiled, and `git diff --check` passed. A read-only OpenAPI request to the already-running local API timed out, so the new live API routes were not verified against that process.


### Security and runtime verification follow-up

- Entitlement write and shared directory verification endpoints now require both active business membership and a server-managed Supabase `app_metadata.platform_admin=true` claim (or `app_metadata.roles` containing `platform_admin`). Business workspace admin alone is insufficient. The UI reads the permission bit from the API.
- Added management event types to the application allowlist and a migration to extend the `business_events` constraint. The verification audit table migration and event constraint migration must both be applied before those operations can be used.
- A temporary local API on port 8002 started successfully; its OpenAPI document returned 200 and listed the request, entitlement, verification, settings, and connection-settings routes. The temporary instance was stopped afterward.
- The existing process on port 8001 is listening but did not answer health/OpenAPI requests during this check. Restart it after applying the two new migrations.


## 2026-10-04 — Data visibility, completion measure, and release gate

- Screenshot 1332 showed the initial “No active business workspaces” screen while the sidebar still said it was loading. Fixed the workspace-loading race so an empty membership result is shown only after the API completes. The no-membership screen now shows the signed-in email locally, explains that saved business data has not been removed, and offers retry/sign-out. Backend and dashboard Supabase hostnames match; read-only aggregate inspection found one active admin membership. The account-to-row match still needs confirmation; no cross-tenant fallback was added.
- Added `LAYER7_COMPLETION_TRACKER.md` as the authoritative open-work register and publication gate. It estimates core Layer 7 implementation at 54% using weighted scores across the eight build areas in `docs/LAYER7_BUILD_PLAN.md`. This is an engineering progress estimate, not release readiness; Layer 7 remains blocked from publication until all P0 criteria close and the end-to-end provider path passes.
- The tracker records pending migrations, platform-admin claim setup, provider credential/adapters, outbound delivery, automation runtime, dashboard module acceptance, test evidence, and documentation reconciliation, with explicit completion criteria.


- Fixed the workspace view to wait for the business-list API before presenting an empty state; added signed-in-email context, retry and sign-out when the API confirms no active membership. The current one-row active membership has not been automatically reassigned; data access remains membership-scoped.
- Added `scripts/check-layer7-release.mjs` and dashboard `release:check` / `release:build` commands. The gate was run and correctly blocked the current release because 20 P0/P1 tasks remain open. The development build still passes for internal work.


## 2026-10-04 — Workspace recovery confirmed

- Owner confirmed the workspace returned after pressing Ctrl+C in the API terminal and restarting Uvicorn. Screenshot 1333 shows FayFort Test Business selected and Overview back. The terminal had shown WatchFiles reload and `httpx` request errors while source changes were being watched; record this as an interrupted hot reload, not data loss. Future recovery: stop the API with Ctrl+C, start a clean Uvicorn process from the repository root, wait for startup complete, then refresh and check workspace selection before touching Supabase data.
- Closed L7-001 based on the restored workspace and earlier API-backed module screenshots. The UI also now distinguishes loading from a confirmed empty membership result. Recalculated core Layer 7 estimate: 55% (weighted by the eight official build areas).
- At that point, the next blockers were applying/verifying schema migrations and configuring the trusted platform-admin account; see the dated updates below for later progress.

## 2026-10-05 — Instagram inbound milestone

- Owner ran the event-type preflight query; it returned zero rows. The directory verification review, management event constraint, and Instagram credential-vault migration objects were confirmed live. Screenshot 1392 confirms review-table RLS and grants; the service-role can query it while anon is denied. All 9 existing business events use allowed types.
- Screenshot 1393 showed the three manually applied migration versions missing from Supabase history. Supabase CLI repair marked `20261004120000`, `20261004121000`, and `20261004130000` applied without rerunning SQL. A subsequent `migration list` confirmed every local migration through `20261004130000` matches its remote history row. L7-002 is closed.

- Owner confirmed a real Instagram DM was delivered through the webhook, matched to the linked account, processed once, and persisted as a new `instagram` conversation shown in the dashboard and Supabase.
- The lookup mismatch was fixed in `app/connections/router.py`: Instagram verification now requests `user_id,username` and saves the professional account `user_id` used by real webhook entries. Re-verification corrected the saved ID. `app/channels/instagram.py` retains a temporary diagnostic that logs only unmatched account IDs.
- Carry-forward: the connection still reports `setup_required` after verification; complete and verify the connected/health lifecycle. Instagram outbound send, receipts and retries are not implemented, so the full provider-backed response path remains open. Keep automatic replies disabled until outbound delivery is supported.
- The owner said exposed secrets were rotated. Confirm the replacement values are active and old values revoked as Layer 8 hardening; do not put credentials in screenshots or source control.

## 2026-10-05 — Trusted platform-admin identity configured

- With the owner's authorization, set and verified `app_metadata.platform_admin=true` for the selected active FayFort owner/admin Auth user through Supabase Auth Admin API. Only the user UUID and claim result were returned; no credentials were exposed.
- Owner signed out/in to refresh the session. Screenshots 1390–1391 confirm entitlement grant controls and verification review controls are visible. The backend guard verifies the bearer token with Supabase, reads server-managed app metadata, and gates shared writes. A negative check using a separate admin is still pending because this business currently has only one active member/admin; see L7-003a in `LAYER7_COMPLETION_TRACKER.md`.

## 2026-10-05 — Migration history reconciled; Instagram health lifecycle updated

- Supabase CLI migration list initially showed versions `20261004120000`, `20261004121000`, and `20261004130000` absent remotely. Live checks confirmed the corresponding review-table policies/grants, event constraint, and Instagram credential-vault columns/RPCs. `migration repair --status applied` recorded those already-live migrations without rerunning their SQL; a subsequent migration list confirmed local and remote history match through `20261004130000`. L7-002 closed.
- Fixed Instagram verification so a successful Meta profile check plus confirmed `messages` subscription marks an active connection `connected`. Added safe persistent health timestamp/error-code fields, error status recording without Meta response bodies, and a resume-first guard for paused/disconnected connections. Applied `20261005100000_instagram_connection_health.sql` and confirmed migration history matches.
- On 2026-10-08 the dashboard production build passed after the outbound-delivery UI and retry-control edits, and Python application modules compiled successfully. No automated tests were run. Screenshot 1394 confirms the live Instagram connection shows `connected`, a successful health-check time, and the verified username; L7-004 is closed. The weighted Layer 7 estimate remains 61.25% (rounded to 61%) until outbound delivery passes live Meta acceptance. L7-005 now has the Instagram send adapter, delivery ledger, opt-in controls, message-level receipt display, human reply routing, and guarded retry for explicit rejections. Screenshot 1395 and a read-only schema check confirm the delivery migration is applied; migration-ledger reconciliation and provider-backed acceptance remain outstanding. The connected Instagram account currently has outbound disabled and auto-reply unset.
