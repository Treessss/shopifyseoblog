from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.agents import IntegrationHealthSummary
from app.services.integration_health import get_integration_health_summary

router = APIRouter()


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {
        "ok": "true",
        "service": settings.service_name,
        "environment": settings.environment,
        "version": settings.api_version,
    }


@router.get("/health/integrations", response_model=IntegrationHealthSummary)
def integration_health(settings: Settings = Depends(get_settings)) -> IntegrationHealthSummary:
    return get_integration_health_summary(settings)
