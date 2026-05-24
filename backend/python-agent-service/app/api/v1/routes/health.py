from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings

router = APIRouter()


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {
        "ok": "true",
        "service": settings.service_name,
        "environment": settings.environment,
        "version": settings.api_version,
    }
