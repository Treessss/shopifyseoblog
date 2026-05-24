from app.domain.content.blueprint import build_content_article_blueprint
from app.schemas.content import ContentArticleBlueprint


def get_content_article_blueprint() -> ContentArticleBlueprint:
    return build_content_article_blueprint()
