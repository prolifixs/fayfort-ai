# Deploying FayFort AI

| Piece | Where | How it is reached |
| --- | --- | --- |
| Public site (`web/`) | Vercel project `fayfort-web` | `www.fayfort.com`, `fayfort.com` |
| Control Center (`dashboard/`) | Vercel project `fayfort-app` (root `dashboard/`) | `app.fayfort.com` |
| API (`app/`) | Hostinger VPS, Docker (`deploy/api/`) | `api.fayfort.com` through Cloudflare Tunnel `fayfort-api-prod` |
| Development API | Owner's PC | `api-dev.fayfort.com` through tunnel `fayfort-api-dev` |
| Database, auth, storage | Supabase `lirauxdhnknfiqjnulxb` | — |

Nothing listens on the VPS's public IP for FayFort: the API binds to `127.0.0.1:8001` and the tunnel
connects outward to Cloudflare. No firewall port needs opening.

## API on the VPS (Gate 6)

One-time setup, as root on the VPS:

```bash
# 1. Docker (skip if `docker compose version` already works)
curl -fsSL https://get.docker.com | sh

# 2. Code: a read-only deploy key for this repository
mkdir -p /opt/fayfort && cd /opt/fayfort
ssh-keygen -t ed25519 -N "" -C "fayfort-vps-deploy" -f /root/.ssh/fayfort_deploy
cat /root/.ssh/fayfort_deploy.pub    # add in GitHub → repo Settings → Deploy keys (read-only)
cat >> /root/.ssh/config <<'CFG'
Host github-fayfort
  HostName github.com
  User git
  IdentityFile /root/.ssh/fayfort_deploy
  IdentitiesOnly yes
CFG
ssh-keyscan github.com >> /root/.ssh/known_hosts
git clone git@github-fayfort:prolifixs/fayfort-ai.git

# 3. Settings and secrets (owner fills the blanks; never commit these files)
cp fayfort-ai/deploy/api/api.env.example api.env && chmod 600 api.env && nano api.env
printf 'TUNNEL_TOKEN=\n' > tunnel.env && chmod 600 tunnel.env && nano tunnel.env

# 4. Start
cd fayfort-ai && docker compose -f deploy/api/compose.yml up -d --build
docker compose -f deploy/api/compose.yml ps
curl -s http://127.0.0.1:8001/health
```

The tunnel token comes from Control Center → Platform admin → Infrastructure: create tunnel
`fayfort-api-prod`, route hostname `api` to it, then "Install command (Linux)". Copy only the long
token at the end of that command into `tunnel.env`.

Updating to the latest `main`:

```bash
cd /opt/fayfort/fayfort-ai && git pull --ff-only && docker compose -f deploy/api/compose.yml up -d --build
```

Rollback: `git checkout <previous commit>` and run the same `up -d --build`.

After the VPS is live:
- Set the Meta Instagram webhook to `https://api.fayfort.com/webhooks/instagram`.
- On the development PC, set the background-job flags in `.env` to `false`
  (`AUTOMATION_SCHEDULER_ENABLED`, `INBOUND_RECONCILIATION_ENABLED`, `REQUEST_MEDIA_RETENTION_ENABLED`,
  `MEMBER_CHAT_RETENTION_ENABLED`) so only one machine runs scheduled jobs.

## Control Center on Vercel (Gate 4)

Vercel project `fayfort-app`, repository `prolifixs/fayfort-ai`, root directory `dashboard/`
(`dashboard/vercel.json` adds the single-page-app rewrite and security headers). Environment variables
(all public values, safe in the browser):

| Variable | Value |
| --- | --- |
| `VITE_FAYFORT_API_URL` | `https://api.fayfort.com` |
| `VITE_SUPABASE_URL` | `https://lirauxdhnknfiqjnulxb.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` or `V_SUPABASE_ANON_KEY` | the project's anon (public) key. Production uses `V_SUPABASE_ANON_KEY` because Vercel flags `VITE_*_KEY` names; the build maps it in `vite.config.ts`. |

Then add the domain `app.fayfort.com` to the project and, in Cloudflare DNS, a `CNAME app →
cname.vercel-dns.com` record set to **DNS only**. In Supabase → Authentication → URL Configuration,
add `https://app.fayfort.com/**` to the redirect URLs.

## Authentication and workforce (Auth plan A0–A7)

- **Database.** Apply `supabase/migrations/20261014100000_workforce_accounts.sql` before deploying an API that includes `app/workforce/`. It adds the invitation and deactivation columns, the append-only `workforce_audit` ledger, `workforce_auth_events` and `release_workforce_assignments`.
- **Auth links.** Every Supabase Auth email lands on `https://app.fayfort.com/auth/callback`. The redirect allow-list entry `https://app.fayfort.com/**` covers it. Invitations sent before this change still work through `/worker/accept`.
- **Two-step verification.** The Control Center always asks staff to set up or enter an authenticator code. The API starts enforcing it only when `STAFF_MFA_REQUIRED=true` is set in `/opt/fayfort/api.env` and the API container restarts. Do that after every admin and worker has enrolled.
- **Lost authenticator.**
  - A platform admin resets a worker from Control Center → FayFort Workers → the worker → "Reset two-step verification".
  - If the only platform admin loses their phone, remove the factor in Supabase → Authentication → Users → the user → "Remove MFA factors".
- **Turnstile.** Put the public site key in the dashboard build as `VITE_TURNSTILE_SITEKEY` (Vercel → fayfort-app → Environment Variables), redeploy, confirm sign-in shows the check, and only then turn on captcha in Supabase → Authentication → Attack Protection with the secret key.
- **Email OTP expiration.** Keep `AUTH_EMAIL_LINK_TTL_SECONDS` equal to Supabase Auth → Email → "Email OTP expiration", so invitation expiry shows correctly.

## Email system (email plan E0–E6)

- **Database.** Apply `supabase/migrations/20261014200000_email_system.sql` before deploying an API that includes `app/mailer/`.
- **Resend.** The domain `fayfort.com` must be **Verified** in Resend. Its DNS records are TXT `resend._domainkey` and CNAMEs `send` and `rsend`, all DNS only in Cloudflare.
- **Turning sending on.** In `/opt/fayfort/api.env` set `RESEND_API_KEY` (paste it in nano; never put it in chat or git) and `EMAIL_DELIVERY_ENABLED=true`, then rerun the update command. Control Center → Emails shows "Sending is on" once both are in place.
- **Turning a type off.** Control Center → Emails → Email types. Members choose their own in Settings → Email notifications. Every customer email has an unsubscribe link, and newsletters also carry one-click `List-Unsubscribe` headers.
- **Troubleshooting.** Control Center → Emails → Sent emails shows each email's status and the reason it was skipped or failed. Failed customer emails can be retried from there.
- **Turnstile.** The public site key ships in the dashboard and runs only on `*.fayfort.com`. Once that build is live, enter the secret in Supabase → Authentication → Attack Protection → Captcha (Cloudflare Turnstile). Supabase then requires the check on sign-up, sign-in and password reset. Local dashboards on 127.0.0.1 can't pass it, so sign in on app.fayfort.com while captcha is on.

## Products and commerce (commerce plan P0–P10)

Shopify (Basic plan, one store) is the engine; FayFort is the experience. See `docs/PRODUCT_COMMERCE_PLAN.md`.

1. **Database**: apply `supabase/migrations/20261015100000_commerce.sql` (additive; safe before the code deploy).
2. **Shopify app** (owner): Shopify admin → Settings → Apps → Develop apps → *Build apps in Dev Dashboard*. Create an app
   named "FayFort", give it the Admin API scopes `read_products, write_products, read_inventory, read_orders,
   write_draft_orders, read_draft_orders, write_discounts, read_discounts`, release a version and install it on the store.
   Copy the **Client ID** and **Client secret**.
3. **Headless channel** (owner): install Shopify's free *Headless* sales channel, create a storefront and copy its
   **private** Storefront access token. Enable the Storefront scopes `unauthenticated_read_product_listings`,
   `unauthenticated_write_checkouts` and `unauthenticated_read_checkouts`.
4. **Server settings** (owner): `nano /opt/fayfort/api.env` (the live settings file; never the copy inside the repo), fill the Shopify block from
   `api.env.example`, then redeploy the API.
5. **Connect** (Control Center → Shop → Overview): *Set up Shopify* creates the FayFort category field and registers the
   webhooks at `https://api.fayfort.com/commerce/shopify/webhooks`; then *Sync now* copies the catalog.
6. **Categories**: Shopify products match the 968 FayFort categories by the `fayfort.category_ref` field, product type or
   tags. Anything unmatched appears under Shop → Category mapping. Tag a Shopify product `fayfort-hide` (for example
   services or the LANDED ebook) to keep it out of the FayFort shop entirely.
7. **Social channels (last)**: install the free *TikTok* and *Facebook & Instagram* channel apps and publish products to
   them. They read the same Shopify catalog; FayFort needs no changes.

## Handoff windows and database keep-alive

- **Handoff windows** (`app/handoffs/window.py`, on by default). After a customer asks for a person, they get a
  holding reply instead of silence (at most every 5 minutes). If nobody replies within 15 minutes, or the person
  stops replying for 30 minutes, the handoff closes, the customer is told the AI is back, and the AI answers again.
  On the website chat the AI keeps answering while the member waits and steps back only while a person is chatting.
  Tune with the `HANDOFF_*` settings in `/opt/fayfort/api.env`.
- **Keep-alive** (`app/infrastructure/keepalive.py`, on by default). Every 6 hours the API reads the database, writes
  `platform_heartbeats` and calls Supabase Auth, so the Free project isn't paused for inactivity. Needs migration
  `20261015200000_platform_heartbeats.sql`.
