from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "FayFort AI"
    APP_ENV: str = "development"
    APP_VERSION: str = "1.0.0"

    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000
    WORKER_INVITE_REDIRECT_URL: str = "http://127.0.0.1:5173/worker/accept"

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
    META_VERIFY_TOKEN: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()
