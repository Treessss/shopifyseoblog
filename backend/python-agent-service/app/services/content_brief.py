from app.core.config import Settings
from app.domain.content.brief import build_content_article_brief
from app.schemas.content import ContentArticleBrief
from app.schemas.workflow import ContentWorkflowRequest


def get_content_article_brief(request: ContentWorkflowRequest, settings: Settings) -> ContentArticleBrief:
    return build_content_article_brief(request, settings)
