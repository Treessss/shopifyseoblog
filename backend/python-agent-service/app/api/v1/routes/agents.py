from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.agents import AgentCenterSnapshot
from app.schemas.workflow import ContentWorkflowRequest
from app.services.agent_center import create_agent_center_snapshot, get_agent_center_snapshot

router = APIRouter()


@router.get("", response_model=AgentCenterSnapshot)
def agents() -> AgentCenterSnapshot:
    return get_agent_center_snapshot()


@router.post("/snapshot", response_model=AgentCenterSnapshot)
def agent_snapshot(
    request: ContentWorkflowRequest,
    settings: Settings = Depends(get_settings),
) -> AgentCenterSnapshot:
    return create_agent_center_snapshot(request, settings)
