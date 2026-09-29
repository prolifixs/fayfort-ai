from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "FayFort AI"
    APP_ENV: str = "development"
    APP_VERSION: str = "1.0.0"

    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000

    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
HF_API_URL: str = "https://router.huggingface.co/hf-inference/models/HuggingFaceH4/zephyr-7b-beta"
HF_TOKEN: str


settings = Settings()