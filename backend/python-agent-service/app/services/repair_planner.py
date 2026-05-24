from app.core.config import Settings
from app.domain.content.repair import build_article_repair_plan
from app.schemas.content import ArticleRepairPlan, ArticleRepairPlanInput


def get_article_repair_plan(article: ArticleRepairPlanInput, settings: Settings) -> ArticleRepairPlan:
    return build_article_repair_plan(article, settings)
