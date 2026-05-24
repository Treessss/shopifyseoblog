from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


PriorityLevel = Literal["critical", "high", "medium", "low"]


@dataclass(slots=True)
class QuickWinSignal:
    keyword: str
    position: float
    impressions: int
    clicks: int
    ctr: float
    search_intent: str | None = None
    opportunity_score: float | None = None
    priority: PriorityLevel = "medium"


@dataclass(slots=True)
class CompetitorGapSignal:
    keyword: str
    competitor: str
    competitor_position: float
    search_volume: int
    difficulty: int | None = None
    search_intent: str | None = None
    opportunity_score: float | None = None
    priority: PriorityLevel = "medium"


@dataclass(slots=True)
class PerformanceQuadrantSignal:
    path: str
    title: str
    category: Literal["Star", "Overperformer", "Underperformer", "Declining"]
    monthly_pageviews: int
    avg_position: float
    trend_percent: float
    action: str
    priority: PriorityLevel = "medium"


@dataclass(slots=True)
class ContentPriorityRecommendation:
    title: str
    reason: str
    action: str
    priority: PriorityLevel
    score: float
    source: Literal["quick_win", "competitor_gap", "performance_matrix"]

