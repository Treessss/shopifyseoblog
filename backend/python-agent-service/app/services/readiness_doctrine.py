from app.domain.content.readiness import build_content_readiness_doctrine
from app.schemas.content import ContentReadinessDoctrine


def get_content_readiness_doctrine() -> ContentReadinessDoctrine:
    return build_content_readiness_doctrine()
