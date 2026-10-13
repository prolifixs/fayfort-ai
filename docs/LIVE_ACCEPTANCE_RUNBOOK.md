# Live acceptance runbook — business handoff closeout and Messenger (L7-024)

Prepared 2026-10-13. This runbook closes two open items in one sitting:

| Item | Where it is tracked | What closes it |
| --- | --- | --- |
| Departmental Flow State Gate 2: business handoff closeout (3 points, 97 → 100) | `docs/DEPARTMENTAL_FLOW_STATE_PLAN.md` | Accepted staff reply through the atomic reply RPC, plus an accepted provider-backed delivery of a staff reply |
| L7-024: Messenger live provider acceptance (Layer 7 release gate) | `LAYER7_COMPLETION_TRACKER.md` | Verified Page connection, a live inbound message, duplicate suppression, and a provider-backed reply |

The two items share their last step, a staff reply from Operations Center delivered through Messenger, so one controlled Messenger session closes both.

Nothing in Part A contacts anyone outside FayFort. In Part B, the only external messages go between a Facebook Page you control and your own Facebook account. Keeping the Meta app in **Development mode** means only people with a role on the app can message the Page or receive replies, so no real customer can be reached.

## Code readiness (done before this runbook)

- The business reply API returns `delivery_error_code` alongside `delivery_status`. Operations Center now says in plain words whether a staff reply was sent, saved only, or blocked, and why: outbound off, outside the 24-hour Messenger window, connection unavailable, or uncertain.
- `python -m scripts.layer7_cli messenger-preflight --public-url <https-url>` is a read-only check that a public tunnel reaches this API's webhook. It checks HTTPS, API health through the tunnel, the verify-token challenge, and that unsigned POSTs are rejected. It never prints the verify token and never calls Meta.
- The Messenger webhook, Page verification/subscription, signature validation, inbound deduplication, Send API adapter, delivery ledger and 24-hour window already have tests (370 backend tests pass).

## Owner approvals needed (record each in the plan when given)

1. Part A: create one labelled synthetic conversation and handoff in the test business (no provider channel). The inbound step runs one AI response against the business AI budget, a fraction of a cent.
2. Part B: save Messenger Page credentials in the vault for the test business, enable outbound on that connection, and send live messages between your Page and your own account.
3. After the run: whether to leave outbound enabled, and whether to keep the labelled records for review (the default so far has been to keep them).

## Prerequisites

- Local API running on `127.0.0.1:8001` via `scripts\start-local-api.ps1`, and the dashboard on `127.0.0.1:5173`.
- `META_VERIFY_TOKEN` set in `.env` (the API reads it at startup).
- Worker account signed in to Operations Center with the conversation-intake department enabled.
- `FAYFORT_ACCESS_TOKEN` exported for the CLI. It must be a business-member session token for the test business.
- For Part B:
  - A Meta developer app (Business type) in Development mode, with the Messenger product added.
  - A Facebook Page you manage.
  - Your personal Facebook account holding a role (admin, developer or tester) on the app.
  - A Page access token with `pages_messaging` and `pages_manage_metadata`; the second is needed to subscribe the app to the Page.
  - The app secret.
  - **Never paste tokens or the app secret into chat. Enter them only in the dashboard vault form.**
- A public HTTPS tunnel to `http://127.0.0.1:8001`. **ngrok is recommended** because its local inspector (`http://127.0.0.1:4040`) can replay an exact signed webhook request, which is the cleanest duplicate-suppression test. A Cloudflare quick tunnel works for everything except the replay.

## Part A — staff reply RPC on a synthetic handoff (no external contact)

1. Create the labelled synthetic inbound message on the manual channel:
   ```powershell
   python -m scripts.layer7_cli simulate-manual --business-id <TEST_BUSINESS_ID> `
     --customer-external-id synthetic-acceptance-20261013-handoff `
     --provider-event-id synthetic-acceptance-20261013-1 `
     --content "[SYNTHETIC ACCEPTANCE] Please connect me to a person"
   ```
   Note the returned `conversation_id`.
2. Request a handoff:
   `python -m scripts.layer7_cli handoffs-request --business-id <TEST_BUSINESS_ID> --conversation-id <CONVERSATION_ID> --reason customer_requested`
3. In Operations Center as the worker:
   1. Choose **Available**.
   2. Claim the new conversation-intake item and open it.
   3. Confirm the Business handoff and Business conversation panels show the synthetic transcript.
4. Send the reply `[SYNTHETIC ACCEPTANCE] Staff reply 2026-10-13`.
   - **Expected:** the notice says *"Reply saved to the conversation. This channel has no provider delivery, so nothing was sent to the customer."*
   - **Expected:** the transcript shows the agent message.
5. Read-only checks:
   - Exactly one new `messages` row with `sender_type = 'agent'` on that conversation.
   - The handoff stays `active` and owned by the worker.
   - The work item stays `claimed`.
   - There are no `outbound_deliveries` rows for that message.
6. Select **Return to automation**.
   - **Expected:** the handoff is `returned` and the work item is `completed`.
   - **Expected:** work history reads `created → claimed → completed`.

Part A accepts the atomic staff reply RPC with ownership checks. It does not accept provider delivery; Part B does.

## Part B — Messenger live acceptance and provider-backed staff reply

1. **Tunnel and preflight**
   1. Start the tunnel, for example `ngrok http 127.0.0.1:8001`, and copy its `https://` URL.
   2. Run: `$env:META_VERIFY_TOKEN = "<same as .env>"; python -m scripts.layer7_cli messenger-preflight --public-url https://<tunnel>`
   3. All four checks must PASS before you continue.
2. **Meta webhook**
   1. In the Meta app, open Messenger → Webhooks.
   2. Set the callback URL to `https://<tunnel>/webhooks/messenger` and the verify token to the `META_VERIFY_TOKEN` value.
   3. Verify and save, then subscribe the field `messages`. Do not subscribe `message_echoes`; the API ignores echoes anyway.
3. **Connection**
   1. In the dashboard, open Connections for the test business and create the Messenger connection.
   2. Enter the Page ID, Page access token and app secret in the vault form.
   3. Select **Verify Page**.
   4. **Expected:** the Page name is shown, the messages subscription is confirmed, and the status is `connected`.
4. **Outbound on, auto-reply off**
   1. Select **Enable outbound**.
   2. Leave auto-replies **disabled**. Staff replies need outbound; automatic AI replies are not part of this acceptance.
5. **Live inbound**
   1. From your own Facebook account, send the Page: `[LIVE ACCEPTANCE] hello 2026-10-13`.
   2. **Expected:** a new `messenger` conversation appears in the test business with your message.
   3. **Expected:** the Page sends nothing back, because auto-reply is off.
   4. **Expected:** the channel event is `processed` with delivery `not_required`.
6. **Duplicate suppression**
   1. In the ngrok inspector, replay the exact webhook request.
   2. **Expected:** HTTP 200 with `processed: 0`.
   3. **Expected:** no second customer message row and no second channel event.
7. **Handoff and provider-backed staff reply.** Do this within 24 hours of your inbound message.
   1. Request a handoff on that conversation from Handoffs or with the CLI.
   2. In Operations Center, the worker claims it and replies `[LIVE ACCEPTANCE] staff reply`.
   3. **Expected:** the notice reads *"Reply sent to the customer."*
   4. **Expected:** the message arrives in Messenger on your account.
   5. **Expected:** one `outbound_deliveries` row with `channel = 'messenger'` and status `sent`.
8. **Close**
   1. Select **Return to automation**.
   2. **Expected:** the handoff is `returned` and the work item is `completed`.
9. **After the run (owner choice)**
   - Disable outbound, or leave it on.
   - Keep auto-reply off until it is explicitly approved.
   - Stop the tunnel. The Meta webhook will fail until a stable public URL exists, which is expected for a local setup.

## Evidence to record

- Part A: conversation ID, handoff ID, work item ID, the agent message ID, and the final handoff/work states.
- Part B:
  - Connection ID and verified Page name (no tokens).
  - Inbound conversation ID and provider event ID.
  - Replay result showing `processed: 0`.
  - Staff reply message ID and delivery ID with status `sent`.
  - Final handoff/work states.
- Then:
  - Mark L7-024 complete in `LAYER7_COMPLETION_TRACKER.md` and run `npm run release:check` from `dashboard/`.
  - Set Gate 2 to 12/12 in `docs/DEPARTMENTAL_FLOW_STATE_PLAN.md`, which makes the total 100.

## If something fails

| Symptom | Likely cause |
| --- | --- |
| Preflight challenge `HTTP 403` | `META_VERIFY_TOKEN` in the shell differs from the API's `.env`, or the API was started before `.env` changed |
| Preflight health fails | The tunnel points at the wrong port, or the API isn't running (`start-local-api.ps1`) |
| Verify Page: "Meta rejected the Page token" | Token expired or missing `pages_messaging` |
| Verify Page: "rejected the Messenger messages subscription" | Missing `pages_manage_metadata`, or the webhook isn't configured in the app |
| Webhook returns 401 "signature is invalid" | The app secret in the vault isn't the secret of the app that owns the webhook |
| Inbound message never arrives | The sender has no role on the app while it's in Development mode, or `messages` isn't subscribed |
| Staff reply notice: *outbound delivery is turned off* | **Enable outbound** on the connection |
| Staff reply notice: *within 24 hours* | Send a fresh message from your account, then reply again. Replies outside the window need Meta's human-agent tag, which this build does not use |
| Staff reply notice: *could not be confirmed* | Check `outbound_deliveries` before retrying. The ledger prevents a silent double send |
