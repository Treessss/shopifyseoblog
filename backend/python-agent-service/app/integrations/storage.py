from __future__ import annotations

from app.core.config import Settings
from app.schemas.agents import AgentRole, IntegrationStatus


def get_storage_integration_status(settings: Settings) -> IntegrationStatus:
    ready = bool(settings.database_url)

    return IntegrationStatus(
        key="storage",
        label="Operational Storage",
        owner=AgentRole.researcher,
        status="ready" if ready else "blocked",
        summary=(
            "Database URL is available for Python-owned agent state, evidence, and article records."
            if ready
            else "Database URL is missing; Python can compute stateless plans but cannot persist agent state yet."
        ),
        required_environment=["AGENT_DATABASE_URL"],
        capabilities=[
            "persist_agent_snapshot",
            "persist_content_brief",
            "read_store_context",
            "write_quality_gate_result",
        ],
        next_step=(
            "Create repository classes for stores, articles, evidence, and quality gate results."
            if ready
            else "Configure AGENT_DATABASE_URL before moving source-of-truth storage into Python."
        ),
    )
