from app.core.config import Settings
from app.domain.content.execution import build_content_workflow_execution_plan
from app.schemas.workflow import ContentWorkflowExecutionPlan, ContentWorkflowExecutionRequest
from app.services.integration_health import get_integration_health_summary
from app.services.workflow_planner import build_content_workflow_plan


def get_content_workflow_execution_plan(
    request: ContentWorkflowExecutionRequest,
    settings: Settings,
) -> ContentWorkflowExecutionPlan:
    workflow_plan = build_content_workflow_plan(request, settings)
    integration_health = get_integration_health_summary(settings)
    return build_content_workflow_execution_plan(request, workflow_plan, integration_health)
