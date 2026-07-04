from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    APP_NAME: str = "PalmWatch API"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    ENVIRONMENT: str = "development"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Database
    POSTGIS_HOST: str = "localhost"
    POSTGIS_PORT: int = 5432
    POSTGIS_DB: str = "palmwatch"
    POSTGIS_USER: str = "palmwatch_user"
    POSTGIS_PASSWORD: str = ""
    DATABASE_URL: str | None = None

    @property
    def db_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"postgresql+psycopg2://{self.POSTGIS_USER}:{self.POSTGIS_PASSWORD}"
            f"@{self.POSTGIS_HOST}:{self.POSTGIS_PORT}/{self.POSTGIS_DB}"
        )

    # Supabase
    SUPABASE_URL: str | None = None
    SUPABASE_ANON_KEY: str | None = None
    SUPABASE_SERVICE_ROLE_KEY: str | None = None

    # GEE
    GEE_SERVICE_ACCOUNT: str | None = None
    GEE_KEY_FILE: str | None = None
    GEE_PROJECT: str | None = None

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Sentry
    SENTRY_DSN: str | None = None

    # Pipeline
    OUTPUT_DIR: str = "results/"
    CACHE_DIR: str = "cache/"
    MAX_WORKERS: int = 4
    RETRY_ATTEMPTS: int = 3
    RETRY_DELAY_SECONDS: int = 10


settings = Settings()
