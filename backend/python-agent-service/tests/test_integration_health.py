from app.api.v1.routes.health import integration_health
from app.core.config import Settings
from app.services.integration_health import get_integration_health_summary


def test_integration_health_marks_unconfigured_dependencies_blocked() -> None:
    summary = get_integration_health_summary(Settings())

    assert summary.status == "blocked"
    assert summary.ready_count == 0
    assert summary.blocked_count == 4
    assert [integration.key for integration in summary.integrations] == [
        "shopify",
        "search_console",
        "queue",
        "storage",
    ]
    assert all(integration.next_step for integration in summary.integrations)


def test_integration_health_marks_configured_dependencies_ready() -> None:
    summary = get_integration_health_summary(
        Settings(
            shopify_store_domain="example.myshopify.com",
            shopify_admin_access_token="shpat_test",
            google_search_console_property_url="https://example.com/",
            google_client_id="client",
            google_client_secret="secret",
            redis_url="redis://localhost:6379",
            database_url="postgres://local",
        )
    )

    assert summary.status == "ready"
    assert summary.ready_count == 4
    assert summary.blocked_count == 0
    assert {integration.status for integration in summary.integrations} == {"ready"}


def test_integration_health_route_handler() -> None:
    summary = integration_health(Settings(redis_url="redis://localhost:6379"))

    assert summary.status == "degraded"
    assert summary.ready_count == 1
    assert summary.blocked_count == 3
