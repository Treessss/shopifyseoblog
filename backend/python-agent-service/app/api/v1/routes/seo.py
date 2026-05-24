from fastapi import APIRouter

from app.schemas.seo import ContentPriorityBoard
from app.services.seo_board import get_content_priority_board

router = APIRouter()


@router.get("/board", response_model=ContentPriorityBoard)
def content_priority_board() -> ContentPriorityBoard:
    return get_content_priority_board()
