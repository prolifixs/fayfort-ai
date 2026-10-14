# FayFort AI API, production image (plan Gate 6). Build from the repository root:
#   docker build -f deploy/api/Dockerfile -t fayfort-api .
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/fayfort

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Unprivileged runtime user; the API needs no write access to its own code.
RUN useradd --system --uid 10001 --no-create-home fayfort
USER fayfort

# Settings come from the environment (compose env_file), never from a baked-in .env.
# One worker: the automation scheduler and retention jobs run inside the process.
CMD ["sh", "-c", "exec uvicorn app.main:app --host \"${API_HOST:-127.0.0.1}\" --port \"${API_PORT:-8001}\" --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"API_PORT\",\"8001\")}/health', timeout=4)"
