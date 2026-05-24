from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.seo.scoring import ContentQualityAssessment
from app.domain.seo.strategy import (
    CompetitorGapSignal,
    ContentPriorityRecommendation,
    PerformanceQuadrantSignal,
    QuickWinSignal,
)


@dataclass(slots=True)
class ContentPriorityBoard:
    quick_wins: list[QuickWinSignal] = field(default_factory=list)
    competitor_gaps: list[CompetitorGapSignal] = field(default_factory=list)
    performance_matrix: list[PerformanceQuadrantSignal] = field(default_factory=list)
    recommendations: list[ContentPriorityRecommendation] = field(default_factory=list)
    quality_audit: ContentQualityAssessment | None = None

