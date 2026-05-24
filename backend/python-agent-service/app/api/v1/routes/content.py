from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.content import ArticleQualityGate, ArticleQualityInput, ArticleRepairPlan, ArticleRepairPlanInput
from app.schemas.workflow import ContentWorkflowPlan, ContentWorkflowRequest
from app.services.quality_gate import evaluate_article_quality
from app.services.repair_planner import get_article_repair_plan
from app.services.workflow_planner import build_content_workflow_plan

router = APIRouter()


@router.post("/quality-gate", response_model=ArticleQualityGate)
def quality_gate(
    article: ArticleQualityInput,
    settings: Settings = Depends(get_settings),
) -> ArticleQualityGate:
    return evaluate_article_quality(article, settings)


@router.post("/repair-plan", response_model=ArticleRepairPlan)
def repair_plan(
    article: ArticleRepairPlanInput,
    settings: Settings = Depends(get_settings),
) -> ArticleRepairPlan:
    return get_article_repair_plan(article, settings)


@router.post("/workflow-plan", response_model=ContentWorkflowPlan)
def workflow_plan(
    request: ContentWorkflowRequest,
    settings: Settings = Depends(get_settings),
) -> ContentWorkflowPlan:
    return build_content_workflow_plan(request, settings)
