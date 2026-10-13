# Live acceptance runbook — business handoff closeout over Instagram

Prepared 2026-10-13; switched from Messenger to Instagram the same day (Messenger is deferred to P2, plan D7). This runbook closes one open item in one sitting:

| Item | Where it is tracked | What closes it |
| --- | --- | --- |
| Departmental Flow State Gate 2: business handoff closeout (3 points, 97 → 100) | `docs/DEPARTMENTAL_FLOW_STATE_PLAN.md` | An accepted staff reply through the atomic reply RPC (Part A), plus an accepted provider-backed delivery of a staff reply over Instagram (Part B) |

Nothing in Part A contacts anyone outside FayFort. In Part B, the only external messages go between the FAYFORT Instagram professional account and an Instagram account you control. While the Meta app is in **Development mode**, only accounts with a role on the app (or added as Instagram testers) can message it and receive replies. No real customer can be reached.

## Code readiness (done before this runbook)

- **Reply status.** The business reply API returns `delivery_error_code` alongside `delivery_status`. Operations Center says in plain words whether a staff reply was sent, saved only, or blocked, and why: outbound off, outside the 24-hour window, connection unavailable, or uncertain.
- **Instagram webhook** at `/webhooks/instagram`:
  - GET verify with `META_VERIFY_TOKEN`;
  - POST signed with the app secret stored in the vault for the connection;
  - inbound deduplication by provider event ID.
- **Instagram delivery.** Outbound uses `graph.instagram.com/v26.0/me/messages`, with a delivery ledger and the 24-hour window. All of it is covered by backend tests.
- **Preflight.** `python -m scripts.layer7_cli messenger-preflight --channel instagram` is read-only. It defaults to `PUBLIC_API_URL`, or takes `--public-url`. It checks HTTPS, API health through the tunnel, the verify-token challenge, and that unsigned POSTs are rejected. It never prints the token and never calls Meta. The Infrastructure page runs the same check.

## Owner approvals needed (record each in the plan when given)

1. **Part A:** create one labelled synthetic conversation and handoff in the test business (no provider channel). The inbound step runs one AI response against the business AI budget, a fraction of a cent.
2. **Part B:**
   - use the Instagram connection's vault credentials for the test business;
   - enable outbound on that connection;
   - send live messages between the FAYFORT account and your own Instagram account.
3. **After the run:** whether to leave outbound enabled, and whether to keep the labelled records for review (the default so far has been to keep them).

## Prerequisites

- **Local API and dashboard.** The API runs on `127.0.0.1:8001` (`scripts\start-local-api.ps1`, port from `.env`). The dashboard runs on `127.0.0.1:5173`.
- **Verify token.** `META_VERIFY_TOKEN` is set in `.env`; the API reads it at startup.
- **Worker account** signed in to Operations Center, with the conversation-intake department enabled.
- **CLI token.** `FAYFORT_ACCESS_TOKEN` is exported for the CLI. It must be a business-member session token for the test business.
- **For Part B:**
  - A Meta developer app in Development mode, with the **Instagram** product, "API setup with Instagram login".
  - The FAYFORT Instagram professional account (Business or Creator).
  - A second Instagram account you control, holding a role on the app or added as an Instagram tester.
  - From the app's Instagram settings:
    - the Instagram App ID;
    - the Instagram App Secret;
    - a long-lived Instagram user access token with `instagram_business_basic` and `instagram_business_manage_messages`.
  - **Never paste tokens or the app secret into chat. Enter them only in the dashboard vault form.**
- **Public HTTPS address** for `http://127.0.0.1:8001`:
  - **Now:** a Cloudflare quick tunnel (`scripts\start-tunnel.ps1`). It prints the webhook URL to paste into Meta, and the URL changes every time the tunnel restarts.
  - **After Cloudflare onboarding (Gate 2):** the fixed address `https://api-dev.fayfort.com`, set in Meta once.

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

## Part B — Instagram live acceptance and provider-backed staff reply

1. **Tunnel and preflight**
   1. Run `scripts\start-tunnel.ps1`. It starts the quick tunnel to the configured port, prints the green webhook URL, saves it to `.logs\tunnel-url.txt`, and runs the preflight.
   2. All four preflight checks must PASS before you continue.
   3. To rerun the preflight by hand: `python -m scripts.layer7_cli messenger-preflight --channel instagram --public-url https://<tunnel>`.
2. **Meta webhook**
   1. In the Meta app, open Instagram → API setup with Instagram login → Configure webhooks.
   2. Set the callback URL to `https://<tunnel>/webhooks/instagram` and the verify token to the `META_VERIFY_TOKEN` value.
   3. Verify and save, then subscribe the field `messages`.
   4. Repeat this step whenever the quick tunnel URL changes.
3. **Connection**
   1. In the dashboard, open Connections for the test business and open the Instagram connection (create one if none exists).
   2. Enter the Instagram App ID, App Secret and access token in the vault form.
   3. Select **Verify Instagram**.
   4. **Expected:** "Verified Instagram account: @<username>", the messages subscription is confirmed, and the status is `connected`.
4. **Outbound on, auto-reply off**
   1. Select **Enable outbound**.
   2. Leave auto-replies **disabled**. Staff replies need outbound; automatic AI replies are not part of this acceptance.
5. **Live inbound**
   1. From your own Instagram account, send a DM to the FAYFORT account: `[LIVE ACCEPTANCE] hello 2026-10-13`.
   2. **Expected:** a new `instagram` conversation appears in the test business with your message.
   3. **Expected:** nothing is sent back, because auto-reply is off.
   4. **Expected:** the channel event is `processed` with delivery `not_required`.
6. **Duplicate suppression.** Covered by automated tests. A quick tunnel has no request replay. For a live check, run the session through `ngrok http 127.0.0.1:8001` and replay the request from its inspector (`http://127.0.0.1:4040`).
   - **Expected:** HTTP 200 with `processed: 0`.
   - **Expected:** no second message row.
7. **Handoff and provider-backed staff reply.** Do this within 24 hours of your inbound DM.
   1. Request a handoff on that conversation from Handoffs, or with `python -m scripts.layer7_cli handoffs-request ...`.
   2. In Operations Center, the worker chooses **Available**, claims the item and replies `[LIVE ACCEPTANCE] staff reply`.
   3. **Expected:** the notice reads *"Reply sent to the customer."*
   4. **Expected:** the DM arrives on your Instagram account.
   5. **Expected:** one `outbound_deliveries` row with `channel = 'instagram'` and status `sent`.
8. **Close**
   1. Select **Return to automation**.
   2. **Expected:** the handoff is `returned` and the work item is `completed`.
9. **After the run (owner choice)**
   - Disable outbound, or leave it on.
   - Keep auto-reply off until it is explicitly approved.
   - Stop the tunnel. The Meta webhook fails until the fixed `api-dev.fayfort.com` address exists, which is expected for a local setup.

## Evidence to record

- **Part A:** conversation ID, handoff ID, work item ID, the agent message ID, and the final handoff/work states.
- **Part B:**
  - connection ID and verified username (no tokens);
  - inbound conversation ID and provider event ID;
  - staff reply message ID and delivery ID with status `sent`;
  - final handoff/work states.
- **Then:** set Gate 2 to 12/12 in `docs/DEPARTMENTAL_FLOW_STATE_PLAN.md`, which makes the total 100. L7-024 (Messenger) stays in P2.

## If something fails

| Symptom | Likely cause |
| --- | --- |
| Preflight challenge `HTTP 403` | `META_VERIFY_TOKEN` differs from the API's `.env`, or the API was started before `.env` changed |
| Preflight health fails | The tunnel points at the wrong port (check `python -m app --print-config`), or the API isn't running |
| Verify Instagram: "Meta rejected the token" | The token expired, is for the wrong account type, or lacks `instagram_business_basic` |
| Verify Instagram: "rejected the messages subscription" | Missing `instagram_business_manage_messages`, or the `messages` webhook field isn't subscribed |
| Webhook returns 401 "signature is invalid" | The App Secret in the vault isn't the Instagram App Secret of the app that owns the webhook |
| Inbound DM never arrives | The sender has no role on the app or isn't an accepted Instagram tester; `messages` isn't subscribed; or Meta still has the old tunnel URL |
| Staff reply notice: *outbound delivery is turned off* | **Enable outbound** on the connection |
| Staff reply notice: *within 24 hours* | Send a fresh DM from your account, then reply again |
| Staff reply notice: *could not be confirmed* | Check `outbound_deliveries` before retrying. The ledger prevents a silent double send |
