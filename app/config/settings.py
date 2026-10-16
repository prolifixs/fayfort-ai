from pydantic_settings import BaseSettings, SettingsConfigDict


# Version marker returned by /health; local launchers use it to tell the current
# API apart from stale processes still listening on another port.
API_CONTRACT = "departmental-flow-worker-request-bridge-v1"


class Settings(BaseSettings):
    APP_NAME: str = "FayFort AI"
    APP_ENV: str = "development"
    APP_VERSION: str = "1.0.0"

    # Single source of truth for where the local API listens. `python -m app`,
    # scripts/start-local-api.ps1, scripts/start-tunnel.ps1, the CLI and the
    # dashboard dev server all read these two values from .env.
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8001
    # Public addresses (Platform consolidation plan, Gates 2 and 4). PUBLIC_API_URL is the HTTPS
    # address Meta and other providers reach (e.g. https://api-dev.fayfort.com); APP_PUBLIC_URL is
    # where the dashboard is served. ALLOWED_ORIGINS adds comma-separated browser origins for CORS.
    PUBLIC_API_URL: str = ""
    APP_PUBLIC_URL: str = "http://127.0.0.1:5173"
    ALLOWED_ORIGINS: str = ""
    # Leave empty to derive it from APP_PUBLIC_URL.
    WORKER_INVITE_REDIRECT_URL: str = ""
    # Auth and workforce plan (A3). When true, platform admins and workers must present an
    # MFA-verified session (aal2) on every staff endpoint. Turn on after staff have enrolled.
    STAFF_MFA_REQUIRED: bool = False
    # Must match Supabase Auth -> Email -> "Email OTP expiration" (seconds); used to show
    # whether a worker invitation link is still valid.
    AUTH_EMAIL_LINK_TTL_SECONDS: int = 3600
    # Email system plan (ED1). FayFort's own emails go through the Resend API from the API host.
    # Nothing is sent until EMAIL_DELIVERY_ENABLED is true and RESEND_API_KEY is set.
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "FayFort <updates@fayfort.com>"
    EMAIL_REPLY_TO: str = "support@fayfort.com"
    EMAIL_DELIVERY_ENABLED: bool = False
    EMAIL_SENDER_INTERVAL_SECONDS: int = 15
    # Human handoff windows (app/handoffs/window.py): a customer is never left in silence.
    HANDOFF_WINDOW_ENABLED: bool = True
    HANDOFF_WAIT_MINUTES: int = 15        # nobody replied after a person was asked for -> AI resumes
    HANDOFF_IDLE_MINUTES: int = 30        # the person stopped replying -> AI resumes
    HANDOFF_HOLDING_INTERVAL_MINUTES: int = 5  # at most one holding reply per this many minutes
    # Database keep-alive (app/infrastructure/keepalive.py): a small read and write every few hours so
    # the Supabase Free project is never paused for inactivity while real traffic is low.
    DATABASE_KEEPALIVE_ENABLED: bool = True
    DATABASE_KEEPALIVE_INTERVAL_SECONDS: int = 21600
    # Member plan billing through Stripe (app/billing). Only STRIPE_SECRET_KEY is required: on start the API creates
    # the Standard/Pro products and monthly prices, the customer portal and the webhook endpoint in Stripe by itself.
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""  # optional; only if you create the webhook endpoint yourself
    STRIPE_PRICE_STANDARD: str = ""  # optional; use an existing Stripe price id instead of creating one
    STRIPE_PRICE_PRO: str = ""
    MEMBER_STANDARD_MONTHLY_PRICE: float = 19.0
    MEMBER_PRO_MONTHLY_PRICE: float = 49.0
    BILLING_CURRENCY: str = "usd"
    BILLING_SYNC_INTERVAL_SECONDS: int = 1800
    SUBSCRIPTION_RETURN_GRACE_DAYS: int = 14  # back within this many days keeps the continuous-months count
    SUBSCRIPTION_MAX_PAUSE_MONTHS: int = 3
    # Member ranks (app/membership/ranks.py): refresh every active member's 90-day score every 6 hours.
    MEMBER_RANKS_ENABLED: bool = True
    # Products and commerce plan (P0). Shopify is the commerce engine; FayFort reads its catalog,
    # sends checkouts and invoices to it, and receives its webhooks. Nothing calls Shopify until
    # SHOPIFY_STORE_DOMAIN and Admin API credentials are set.
    # Admin API: either a Dev Dashboard app's client id + secret (client credentials grant, token
    # renewed automatically every 24 h) or a legacy custom-app access token.
    # Operations sweep (app/accounts/operations_flow.py): due recurring orders, group buys, ended giveaways and
    # failing subscription payments become Operations work every 10 minutes.
    OPERATIONS_SWEEP_ENABLED: bool = True
    SHOPIFY_STORE_DOMAIN: str = ""  # e.g. fayfort.myshopify.com
    SHOPIFY_CLIENT_ID: str = ""
    SHOPIFY_CLIENT_SECRET: str = ""  # also verifies webhook signatures
    SHOPIFY_ADMIN_ACCESS_TOKEN: str = ""  # optional legacy alternative to the client id + secret
    SHOPIFY_WEBHOOK_SECRET: str = ""  # optional; defaults to SHOPIFY_CLIENT_SECRET
    # Headless channel private Storefront token, used for checkout carts. Without it, checkout
    # falls back to Shopify cart links (needs the Online Store channel).
    SHOPIFY_STOREFRONT_ACCESS_TOKEN: str = ""
    SHOPIFY_API_VERSION: str = "2025-07"
    COMMERCE_SYNC_ENABLED: bool = False
    COMMERCE_RECONCILE_INTERVAL_SECONDS: int = 21600
    COMMERCE_CURRENCY: str = "USD"
    COMMERCE_UNDER_PRICE: float = 25.0
    # Optional Meta app access token ("app_id|client_token") for Instagram link previews.
    META_OEMBED_ACCESS_TOKEN: str = ""

    SUPABASE_URL: str 
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    HF_CHAT_COMPLETIONS_URL: str = "https://router.huggingface.co/v1/chat/completions"
    HF_MODEL: str = "openai/gpt-oss-20b:deepinfra"
    HF_TOKEN: str
    AI_MAX_INPUT_BYTES: int = 65536
    AI_MODEL_INPUT_PRICE_USD_PER_MILLION: str = "0.04"
    AI_MODEL_OUTPUT_PRICE_USD_PER_MILLION: str = "0.17"
    DIRECTORY_TOOLS_ENABLED: bool = False
    AUTOMATION_SCHEDULER_ENABLED: bool = False
    INBOUND_RECONCILIATION_ENABLED: bool = True
    REQUEST_MEDIA_RETENTION_ENABLED: bool = True
    MEMBER_CHAT_RETENTION_ENABLED: bool = True
    META_VERIFY_TOKEN: str = ""
    INFRASTRUCTURE_MONITOR_ENABLED: bool = False
    INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS: int = 300

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()


LOCAL_DASHBOARD_ORIGINS = ("http://127.0.0.1:5173", "http://localhost:5173")


def _origin(url: str) -> str:
    from urllib.parse import urlsplit

    parts = urlsplit(url.strip())
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else ""


def cors_allowed_origins(config: "Settings | None" = None) -> list[str]:
    """Local dashboard origins plus the app's public origin and any ALLOWED_ORIGINS, de-duplicated."""
    config = config or settings
    candidates = [*LOCAL_DASHBOARD_ORIGINS, _origin(config.APP_PUBLIC_URL)]
    candidates += [_origin(item) for item in config.ALLOWED_ORIGINS.split(",")]
    return list(dict.fromkeys(origin for origin in candidates if origin))


def staff_recovery_redirect_url(config: "Settings | None" = None) -> str:
    config = config or settings
    return config.APP_PUBLIC_URL.rstrip("/") + "/auth/callback?audience=staff&type=recovery"


def worker_invite_redirect_url(config: "Settings | None" = None) -> str:
    config = config or settings
    if config.WORKER_INVITE_REDIRECT_URL.strip():
        return config.WORKER_INVITE_REDIRECT_URL.strip()
    return config.APP_PUBLIC_URL.rstrip("/") + "/auth/callback?audience=staff&type=invite"
