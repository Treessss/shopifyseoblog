from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class PriorityLevel(StrEnum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class QuickWinItem(BaseModel):
    keyword: str
    position: float
    impressions: int
    clicks: int
    ctr: float
    search_intent: str | None = None
    opportunity_score: float | None = None
    priority: PriorityLevel = PriorityLevel.medium


class CompetitorGapItem(BaseModel):
    keyword: str
    competitor: str
    competitor_position: float
    search_volume: int
    difficulty: int | None = None
    search_intent: str | None = None
    opportunity_score: float | None = None
    priority: PriorityLevel = PriorityLevel.medium


class PerformanceQuadrantItem(BaseModel):
    path: str
    title: str
    category: str
    monthly_pageviews: int
    avg_position: float
    trend_percent: float
    action: str
    priority: PriorityLevel = PriorityLevel.medium


class ContentPriorityRecommendationItem(BaseModel):
    title: str
    reason: str
    action: str
    priority: PriorityLevel
    score: float
    source: str


class ContentPriorityBoard(BaseModel):
    quick_wins: list[QuickWinItem] = Field(default_factory=list)
    competitor_gaps: list[CompetitorGapItem] = Field(default_factory=list)
    performance_matrix: list[PerformanceQuadrantItem] = Field(default_factory=list)
    recommendations: list[ContentPriorityRecommendationItem] = Field(default_factory=list)
    quality_score: int
    summary: str
