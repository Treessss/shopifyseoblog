from app.core.config import Settings
from app.domain.agents.orchestration import (
    build_agent_center_snapshot_from_plan,
    build_bootstrap_agent_center_snapshot,
)
from app.schemas.agents import AgentCenterSnapshot
from app.schemas.workflow import ContentWorkflowRequest
from app.services.workflow_planner import build_content_workflow_plan


def get_agent_center_snapshot() -> AgentCenterSnapshot:
    return build_bootstrap_agent_center_snapshot()


def create_agent_center_snapshot(
    request: ContentWorkflowRequest,
    settings: Settings,
) -> AgentCenterSnapshot:
    plan = build_content_workflow_plan(request, settings)
    return build_agent_center_snapshot_from_plan(plan)
