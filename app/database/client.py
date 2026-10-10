from httpx import Client as HttpxClient
from supabase import ClientOptions, create_client, Client

from app.config.settings import settings


# Supabase Python's default PostgREST transport opts into HTTP/2. On Windows the
# shared long-lived HTTP/2 connection has produced intermittent WinError 10035
# read failures during the dashboard event poller. Use the same shared sync
# client for every Supabase service, with HTTP/1.1 keep-alive instead.
_httpx_client = HttpxClient(http2=False, follow_redirects=True)

supabase: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_ROLE_KEY,
    options=ClientOptions(httpx_client=_httpx_client),
)
