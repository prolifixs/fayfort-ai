"""Administrator-only Control Center pages (docs/OPERATIONS_RESTRUCTURE_PLAN.md, phase R1).

Workers work in the Operations Center. The business setup pages are for the platform administrator only: the menu
hides them and this check refuses their API to anyone else (every worker counts as a business "admin" in
trusted_business_member, so the per-endpoint checks alone don't keep workers out).
"""
from __future__ import annotations

import re

from starlette.requests import Request
from starlette.responses import JSONResponse

from app.directory.identity import trusted_platform_admin

ADMIN_ONLY = re.compile(
    r"^/businesses/[^/]+/(automations|connections|entitlements|verification|analytics|ai-usage|settings|channels"
    r"|channel-deliveries|directory/(tools|products)|knowledge|faqs|handoffs/agents)(/|$)"
)


def admin_only_path(path: str) -> bool:
    return bool(ADMIN_ONLY.match(path))


async def admin_pages_guard(request: Request, call_next):
    authorization = request.headers.get("authorization")
    # No sign-in at all: the endpoint answers 401 itself. Signed in but not a platform administrator: refused here.
    if request.method != "OPTIONS" and authorization and admin_only_path(request.url.path):
        if not trusted_platform_admin(authorization):
            return JSONResponse({"detail": "Only a FayFort administrator can open this page."}, status_code=403)
    return await call_next(request)
