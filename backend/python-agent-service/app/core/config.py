from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "Shopify SEO Agent Service"
    environment: str = "local"
    api_version: str = "v1"
    api_prefix: str = "/api/v1"
    min_publish_seo_score: int = 82
    min_editorial_score: int = 72
    expert_panel_pass_score: int = 90

    model_config = SettingsConfigDict(env_prefix="AGENT_", env_file=".env.local", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
