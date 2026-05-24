from fastapi import APIRouter

from app.api.v1.routes import agents, content, health, seo

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(agents.router, prefix="/agents", tags=["agents"])
api_router.include_router(content.router, prefix="/content", tags=["content"])
api_router.include_router(seo.router, prefix="/seo", tags=["seo"])
