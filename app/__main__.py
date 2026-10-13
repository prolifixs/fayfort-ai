"""Start the FayFort API on the host and port configured in .env.

    python -m app                 # start the API on API_HOST:API_PORT
    python -m app --reload        # same, restarting when backend code changes
    python -m app --print-config  # print host/port/base URL/contract as JSON

Every local launcher reads the port through this module so .env stays the
single source of truth.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from app.config.settings import API_CONTRACT, settings


def runtime_config() -> dict[str, object]:
    return {
        "host": settings.API_HOST,
        "port": settings.API_PORT,
        "base_url": f"http://{settings.API_HOST}:{settings.API_PORT}",
        "api_contract": API_CONTRACT,
        "public_api_url": settings.PUBLIC_API_URL or None,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app", description="Run the FayFort API using API_HOST/API_PORT from .env.")
    parser.add_argument("--reload", action="store_true", help="restart when files under app/ change")
    parser.add_argument("--print-config", action="store_true", help="print the configured host, port, base URL and API contract, then exit")
    args = parser.parse_args(argv)
    if args.print_config:
        print(json.dumps(runtime_config()))
        return 0

    import uvicorn

    options: dict[str, object] = {"host": settings.API_HOST, "port": settings.API_PORT, "timeout_graceful_shutdown": 5}
    if args.reload:
        # Watch backend code only so frontend, test and documentation edits do not restart the API.
        options.update(reload=True, reload_dirs=[str(Path(__file__).resolve().parent)])
    uvicorn.run("app.main:app", **options)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
