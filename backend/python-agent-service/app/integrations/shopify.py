from __future__ import annotations

from app.core.config import Settings
from app.schemas.agents import AgentRole, IntegrationStatus


def get_shopify_integration_status(settings: Settings) -> IntegrationStatus:
    has_domain = bool(settings.shopify_store_domain)
    has_token = bool(settings.shopify_admin_access_token)
    ready = has_domain and has_token

    return IntegrationStatus(
        key="shopify",
        label="Shopify Admin",
        owner=AgentRole.publisher_guard,
        status="ready" if ready else "blocked",
        summary=(
            "Shopify Admin credentials are available for product, collection, blog, and article operations."
            if ready
            else "Shopify Admin credentials are not fully configured for Python execution."
        ),
        required_environment=[
            "AGENT_SHOPIFY_STORE_DOMAIN",
            "AGENT_SHOPIFY_ADMIN_ACCESS_TOKEN",
        ],
        capabilities=[
            "read_products",
            "read_collections",
            "read_blog_articles",
            "publish_blog_article",
            "sync_canonical_url",
        ],
        next_step=(
            "Use this adapter for Python-owned publish and catalog sync steps."
            if ready
            else "Move Shopify domain and Admin token into the Python service environment."
        ),
    )
