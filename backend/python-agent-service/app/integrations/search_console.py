from __future__ import annotations

from app.core.config import Settings
from app.schemas.agents import AgentRole, IntegrationStatus


def get_search_console_integration_status(settings: Settings) -> IntegrationStatus:
    has_property = bool(settings.google_search_console_property_url)
    has_oauth = bool(settings.google_client_id and settings.google_client_secret)
    ready = has_property and has_oauth
    status = "ready" if ready else "degraded" if has_property else "blocked"

    return IntegrationStatus(
        key="search_console",
        label="Google Search Console",
        owner=AgentRole.growth_analyst,
        status=status,
        summary=(
            "Search Console property and OAuth credentials are available for Python performance review."
            if ready
            else (
                "Search Console property is configured, but live query data still requires OAuth client ID and client secret; "
                "an API key cannot read Search Console performance data."
            )
            if has_property
            else (
                "Search Console property is missing for Python-owned rank-ready validation; OAuth credentials are also "
                "required for live performance data."
            )
        ),
        required_environment=[
            "AGENT_GOOGLE_SEARCH_CONSOLE_PROPERTY_URL",
            "AGENT_GOOGLE_CLIENT_ID",
            "AGENT_GOOGLE_CLIENT_SECRET",
        ],
        capabilities=[
            "read_performance_queries",
            "detect_low_ctr_queries",
            "detect_striking_distance_keywords",
            "prioritize_refresh_tasks",
        ],
        next_step=(
            "Use this adapter for post-publish query gap and refresh planning."
            if ready
            else "Add the Search Console property plus OAuth client ID and secret; API keys do not unlock performance review."
        ),
    )
