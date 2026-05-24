from __future__ import annotations

from app.core.config import Settings
from app.integrations.queue import get_queue_integration_status
from app.integrations.search_console import get_search_console_integration_status
from app.integrations.shopify import get_shopify_integration_status
from app.integrations.storage import get_storage_integration_status
from app.schemas.agents import IntegrationHealthSummary


def get_integration_health_summary(settings: Settings) -> IntegrationHealthSummary:
    integrations = [
        get_shopify_integration_status(settings),
        get_search_console_integration_status(settings),
        get_queue_integration_status(settings),
        get_storage_integration_status(settings),
    ]
    ready_count = sum(1 for integration in integrations if integration.status == "ready")
    degraded_count = sum(1 for integration in integrations if integration.status == "degraded")
    blocked_count = sum(1 for integration in integrations if integration.status == "blocked")

    return IntegrationHealthSummary(
        status="ready" if blocked_count == 0 else "degraded" if ready_count > 0 or degraded_count > 0 else "blocked",
        ready_count=ready_count,
        degraded_count=degraded_count,
        blocked_count=blocked_count,
        integrations=integrations,
    )
