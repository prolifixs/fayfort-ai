# Layer 7 build plan

## Situation

The official specification defines Layer 7 as Channels, Automation, and the permanent Dashboard Foundation. It is additive to Layers 1–6: the dashboard controls FastAPI; FastAPI enforces access and calls the existing intent, customer/request, and directory/tool services; Supabase remains the durable store.

Repository inspection found a FastAPI backend and existing L4 intent/action, L5 customer/request, and L6 directory modules. Layer 7 foundations are now in place for a normalized manual channel, connection lifecycle, constrained test automation, persisted human handoff, dashboard control API, and durable WebSocket/event layer. Real provider adapters and outbound delivery are still absent. The README phase numbering is older than this official Layer 7 specification.

## Build principles

- Reuse L4–L6 services; do not build a second AI engine or duplicate Layer 6 enforcement.
- Keep provider code in adapters, business state in Supabase, and live updates in events/WebSockets.
- Never expose provider secrets or database credentials as ordinary dashboard fields.
- Add migrations locally first; document relations, indexes, and RLS before considering a live push.
- Run focused tests at each step, with UI and CLI coverage and a full inbound-to-outbound scenario.
- Keep subscription billing undecided; continue to use the generic business entitlement boundary.

## Implementation choice

No frontend framework exists in the repository. Establish a React + TypeScript + Vite dashboard under dashboard/. FastAPI remains the control plane. Dashboard sessions will use Supabase Auth; control endpoints must validate the token and business membership before acting. Begin with a manual/test channel adapter so the normalized path can be exercised without platform credentials. Connection records will refer to protected credentials without returning secret material.

## Implementation status (2026-09-29)

- In place: permanent dashboard shell; Supabase Auth sign-in; authenticated business selection; token-authenticated dashboard API client; functional Connections, Automations, and Human Agents views; live activity subscription using one-use event tickets; authenticated manual inbound; idempotency receipts; scoped connection lifecycle; safe test-only automation definition/execution; persisted human handoff; sanitized event feed; CLI flows for these surfaces.
- Local-only migrations: `20260929130000_layer7_channel_events.sql`, `20260929131000_layer7_business_connections.sql`, `20260929132000_layer7_automations.sql`, `20260929133000_layer7_handoffs.sql`, and `20260929134000_layer7_business_events.sql`. None have been applied.
- Verified locally: production dashboard build, five component UI tests, one Chromium sign-in → workspace → connection setup browser flow, 27 focused backend/CLI/event checks, Python syntax compilation, `git diff --check`, and OpenAPI route registration (29 paths including `/dashboard/businesses`). Browser tests use mock auth/API responses; they do not mutate Supabase.
- Not complete: live Supabase migration application and live-credential verification; real credential vault, OAuth/webhook adapters and outbound delivery; automation scheduling/retries/automatic trigger dispatch; dashboard data and controls for Conversations, Customers, Requests, Directory/Tools, Channels, Entitlements, Verification, Analytics, and Settings; provider-backed full inbound-to-outbound run; production hardening.
## Build steps and checks

1. **Permanent shell and boundaries:** dashboard navigation/modules, typed API/auth boundary, FastAPI router registration, and Layer 7 CLI entrypoint. UI tests cover navigation and responsive shell; CLI tests cover help, configuration, and local simulation.
2. **Normalized channels:** provider-neutral inbound/outbound event and delivery contracts; manual adapter enters the existing L4 → L5 → L6 → response flow. CLI verifies duplicate-event protection and conversation resolution; UI verifies conversation and delivery status.
3. **Connections:** business-scoped records, status/health, safe settings and credential references; authenticated APIs and dashboard lifecycle surfaces. Test state transitions, authorization, and secret omission.
4. **Automation:** definitions, triggers/conditions, enabled state, schedules, executions, idempotency, retries, and failure states. Start with safe internal/test actions. Test dry-run, execute, disable, and duplicate handling through UI and CLI.
5. **Events:** persist important events and publish sanitized live updates; test reconnect and duplicate handling in browser and CLI.
6. **Human handoff:** explicit states, assignment, takeover, return-to-automation, and transition history. Connect L4/L6 review decisions; test each transition through both surfaces.
7. **Operational modules:** safe business settings, directory/tools, entitlements, verification, agents, and analytics. The dashboard must not bypass Layer 6.
8. **End-to-end closure:** inbound → L4 → L5 → L6 → response → outbound; normal operations from dashboard without manual code edits; UI, CLI, migration/RLS, and Layer 8 readiness checks.

## Proposed file structure

- app/api/: dashboard/control, channel, connection, automation, and handoff routers; shared authentication and business-scope dependencies.
- app/channels/: normalized contracts, adapter interface, manual adapter, provider adapters, inbound resolution, and outbound delivery.
- app/connections/: connection lifecycle and safe credential references.
- app/automations/: definitions, trigger evaluation, scheduler, idempotent execution, and retries.
- app/events/: durable event contract, publisher, and WebSocket endpoint.
- app/handoffs/: state transitions and assignment.
- app/schemas/: typed Layer 7 API contracts.
- app/database/: narrow Supabase access modules.
- scripts/layer7_cli.py: inspect, simulate, dry-run, and verify workflows.
- dashboard/src/app/: application router, navigation, and layout.
- dashboard/src/components/: reusable UI controls and loading/error/empty states.
- dashboard/src/features/: conversations, customers, requests, directory/tools, channels, connections, automations, entitlements, verification, agents, analytics, and settings.
- dashboard/src/lib/: typed API/auth clients.
- dashboard/tests/: component and browser end-to-end coverage.
- supabase/migrations/: additive timestamped migrations after schema and RLS review.

## Expected result

Staff can use a permanent dashboard to inspect conversations and operational state, manage supported connections and automations, review directory verification, and take over conversations. At least one normalized channel path enters the existing L4–L6 pipeline and returns a reply through an adapter. FastAPI enforces and Supabase persists state. Layer 8 hardens these interfaces instead of replacing them.

Real platform activation depends on platform app credentials and callback/webhook configuration. Layer 7 builds adapter and connection hooks without exposing secrets; production OAuth hardening, encryption, webhook signatures, rate limits, deployment, and recovery belong to Layer 8. No live Supabase migration will be pushed without review.


## Current checkpoint — 2026-10-04

The implementation-status section above is a historical snapshot from 2026-09-29. Current status, weighted completion estimate, and the complete open-work register are maintained in `LAYER7_COMPLETION_TRACKER.md`. Core Layer 7 implementation is estimated at 54%; it is not publish-ready. Do not publish Layer 7 or describe any unfinished module as complete until the tracker’s publication gate passes.

For a release candidate, use `npm run release:build` from `dashboard/`. The release gate fails while any P0 or P1 acceptance item in `LAYER7_COMPLETION_TRACKER.md` is open. Deployment automation must use this command.

2026-10-04 recovery note: an interrupted Uvicorn `--reload` produced transient `httpx` request errors and an empty workspace display. Ctrl+C and a clean API restart restored FayFort Test Business without changing database rows. The dashboard now waits for the workspace API result before showing an empty state.
- **Human agent workspace blueprint:** Conversations is the chat workspace (history, handoff state/timer, assignment, and ultimately the reply composer); Human Agents is the team queue (FIFO, assignee, availability, and source filters). Requests remains the structured customer-work record, not a second chat surface. Show elapsed wait and queue position now; compute an ETA only after the system tracks agent availability/capacity and measured handling times. Send a live badge/banner for new waiting handoffs and make it open the filtered team queue. Do not invent a countdown when staffing data is unknown.
