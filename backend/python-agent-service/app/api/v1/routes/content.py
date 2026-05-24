from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.content import (
    ArticleQualityGate,
    ArticleQualityInput,
    ContentArticleBrief,
    ContentArticleBlueprint,
    ArticleRepairPlan,
    ArticleRepairPlanInput,
    ContentReadinessDoctrine,
)
from app.schemas.workflow import (
    ContentWorkflowExecutionPlan,
    ContentWorkflowExecutionRequest,
    ContentWorkflowPlan,
    ContentWorkflowRequest,
)
from app.services.content_brief import get_content_article_brief
from app.services.content_blueprint import get_content_article_blueprint
from app.services.quality_gate import evaluate_article_quality
from app.services.readiness_doctrine import get_content_readiness_doctrine
from app.services.repair_planner import get_article_repair_plan
from app.services.workflow_execution import get_content_workflow_execution_plan
from app.services.workflow_planner import build_content_workflow_plan

router = APIRouter()


@router.get("/article-blueprint", response_model=ContentArticleBlueprint)
def article_blueprint() -> ContentArticleBlueprint:
    return get_content_article_blueprint()


@router.post("/article-brief", response_model=ContentArticleBrief)
def article_brief(
    request: ContentWorkflowRequest,
    settings: Settings = Depends(get_settings),
) -> ContentArticleBrief:
    return get_content_article_brief(request, settings)


@router.get("/readiness-doctrine", response_model=ContentReadinessDoctrine)
def readiness_doctrine() -> ContentReadinessDoctrine:
    return get_content_readiness_doctrine()


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


@router.post("/workflow-execution-plan", response_model=ContentWorkflowExecutionPlan)
def workflow_execution_plan(
    request: ContentWorkflowExecutionRequest,
    settings: Settings = Depends(get_settings),
) -> ContentWorkflowExecutionPlan:
    return get_content_workflow_execution_plan(request, settings)
