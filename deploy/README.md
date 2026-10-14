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
