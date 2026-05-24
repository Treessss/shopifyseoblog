from __future__ import annotations

from app.core.config import Settings
from app.schemas.agents import AgentRole, IntegrationStatus


def get_queue_integration_status(settings: Settings) -> IntegrationStatus:
    ready = bool(settings.redis_url)

    return IntegrationStatus(
        key="queue",
        label="Agent Queue",
        owner=AgentRole.writer,
        status="ready" if ready else "blocked",
        summary=(
            "Redis queue URL is available for durable Python agent jobs."
            if ready
            else "Redis queue URL is missing; Python can plan work but cannot own durable background execution yet."
        ),
        required_environment=["AGENT_REDIS_URL"],
        capabilities=[
            "enqueue_content_workflow",
            "resume_stalled_job",
            "track_agent_step",
            "retry_failed_step",
        ],
        next_step=(
            "Route campaign generation jobs through this queue adapter."
            if ready
            else "Configure AGENT_REDIS_URL before migrating worker execution from Next.js to Python."
        ),
    )
