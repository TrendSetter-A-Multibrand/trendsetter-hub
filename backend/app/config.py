"""Единственное место, где читается окружение."""
import os
from dataclasses import dataclass

SCHEMA = "trendsetter_hub"


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    jwt_ttl_minutes: int
    cors_origins: list[str]
    cors_origin_regex: str | None


def get_settings() -> Settings:
    secret = os.environ.get("HUB_JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("HUB_JWT_SECRET не задан или короче 32 символов")
    return Settings(
        database_url=os.environ["HUB_DATABASE_URL"],
        jwt_secret=secret,
        jwt_ttl_minutes=int(os.environ.get("HUB_JWT_TTL_MINUTES", "720")),
        cors_origins=[o.strip() for o in os.environ.get("HUB_CORS_ORIGINS", "").split(",") if o.strip()],
        cors_origin_regex=os.environ.get("HUB_CORS_ORIGIN_REGEX") or None,
    )
