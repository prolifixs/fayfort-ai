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

### Start the local API

The dashboard API port is **8001**. Start the backend from the repository root with:

```powershell
.\scripts\start-local-api.ps1
```

The launcher starts the project's virtualenv Uvicorn on `127.0.0.1:8001`. It watches backend files under `app/` only and bounds graceful shutdown to five seconds so open browser connections cannot stall reloads indefinitely. If a healthy FayFort API with Operations routes already owns that port, it reports that and exits. If another or stale process owns the port, it reports the PID and stops without killing anything. Do not restart this dashboard's API on port 8000.

Run the dashboard separately from `dashboard` with `npm run dev`; Vite uses `127.0.0.1:5173` and fails clearly if that port is already occupied instead of silently switching ports.
