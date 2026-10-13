# Fayfort AI

AI-powered social media customer service and automation platform.

## Purpose

Fayfort AI is being built to automatically handle customer conversations across:

- Instagram
- Facebook
- TikTok

The system will use an AI model to understand customer messages, retrieve relevant business information, generate responses, and escalate conversations to human staff when necessary.

## Technology

- Python
- FastAPI
- Supabase / PostgreSQL
- Hugging Face
- Git / GitHub

## Planned Architecture

Social Platforms
→ Webhooks
→ FastAPI Backend
→ Conversation Engine
→ AI Engine
→ Hugging Face
→ Response
→ Social Platform

## Development Status

### Phase 1
Development environment and project foundation.

### Phase 2
FastAPI backend.

### Phase 3
Supabase database.

### Phase 4
AI integration.

### Phase 5
Instagram integration.

### Phase 6
Facebook integration.

### Phase 7
TikTok integration.

### Phase 8
Human handoff and lead management.

### Phase 9
Production deployment.

### Phase 10
RAG knowledge system.

### Phase 11
Dashboard.

### Phase 12
Model fine-tuning.

## Local Development

### Activate virtual environment

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

### Ports: one source of truth

`API_HOST` and `API_PORT` in the repository `.env` decide where the API listens (default `127.0.0.1:8001`). Everything reads them from there:

- `python -m app` / `scripts\start-local-api.ps1` start the API on that port (`python -m app --print-config` shows what is configured);
- the dashboard dev server and build derive the API URL from them (set `VITE_FAYFORT_API_URL` in `dashboard/.env.local` only to point at a different, e.g. hosted, API);
- `scripts\layer7_cli.py` and `scripts\start-tunnel.ps1` use the same address.

Do not start the API with a bare `uvicorn app.main:app`; uvicorn's own default is port 8000 and ignores `.env`. Both launchers warn if an old FayFort API is still answering on 8000 or 8001 and print the `Stop-Process` command for it.

### Start the local API

```powershell
.\scripts\start-local-api.ps1
```

It starts the project's virtualenv API with reload on the configured port, watching backend files under `app/` only and bounding graceful shutdown to five seconds. If the current FayFort API already owns the port it reports that and exits; if another or stale process owns it, it reports the PID and stops without killing anything.

Run the dashboard separately from `dashboard` with `npm run dev`; Vite uses `127.0.0.1:5173` and fails clearly if that port is already occupied instead of silently switching ports.

### Public webhook tunnel (Instagram / Messenger)

With the API running, open a Cloudflare quick tunnel in a second terminal:

```powershell
.\scripts\start-tunnel.ps1                 # Instagram webhook URL
.\scripts\start-tunnel.ps1 -Channel messenger
```

It refuses to start unless the current API answers on the configured port, finds `cloudflared` on PATH or in Downloads (or use `-CloudflaredPath`), prints the exact webhook URL to paste into Meta, saves it to `.logs\tunnel-url.txt`, and runs the read-only webhook preflight. Quick-tunnel URLs change on every run, so update the Meta callback URL each time.
