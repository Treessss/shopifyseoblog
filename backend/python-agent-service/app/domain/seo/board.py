from __future__ import annotations

from dataclasses import asdict

from app.domain.seo.briefs import ContentPriorityBoard
from app.domain.seo.scoring import ContentQualityAssessment, ContentScoreBreakdown, clamp_score, score_from_signals
from app.domain.seo.strategy import (
    CompetitorGapSignal,
    ContentPriorityRecommendation,
    PerformanceQuadrantSignal,
    PriorityLevel,
    QuickWinSignal,
)
from app.schemas.seo import (
    CompetitorGapItem,
    ContentPriorityBoard as ContentPriorityBoardSchema,
    ContentPriorityRecommendationItem,
    PerformanceQuadrantItem,
    QuickWinItem,
)


def build_content_priority_board(
    *,
    quick_wins: list[QuickWinSignal] | None = None,
    competitor_gaps: list[CompetitorGapSignal] | None = None,
    performance_matrix: list[PerformanceQuadrantSignal] | None = None,
) -> ContentPriorityBoardSchema:
    quick_wins = quick_wins or []
    competitor_gaps = competitor_gaps or []
    performance_matrix = performance_matrix or []

    quality_score = _quality_score(quick_wins, competitor_gaps, performance_matrix)
    recommendations = _recommendations(quick_wins, competitor_gaps, performance_matrix)
    summary = _summary(quick_wins, competitor_gaps, performance_matrix)

    return ContentPriorityBoardSchema(
        quick_wins=[QuickWinItem.model_validate(asdict(item)) for item in quick_wins],
        competitor_gaps=[CompetitorGapItem.model_validate(asdict(item)) for item in competitor_gaps],
        performance_matrix=[PerformanceQuadrantItem.model_validate(asdict(item)) for item in performance_matrix],
        recommendations=[ContentPriorityRecommendationItem.model_validate(asdict(item)) for item in recommendations],
        quality_score=quality_score,
        summary=summary,
    )


def _quality_score(
    quick_wins: list[QuickWinSignal],
    competitor_gaps: list[CompetitorGapSignal],
    performance_matrix: list[PerformanceQuadrantSignal],
) -> int:
    score = 0
    if quick_wins:
        score += 20
    score += min(len(quick_wins), 8) * 6
    score += min(len(competitor_gaps), 8) * 4
    score += min(sum(1 for item in performance_matrix if item.category in {"Underperformer", "Declining"}), 6) * 6
    score += min(sum(1 for item in performance_matrix if item.category == "Star"), 5) * 2
    return clamp_score(score)


def _recommendations(
    quick_wins: list[QuickWinSignal],
    competitor_gaps: list[CompetitorGapSignal],
    performance_matrix: list[PerformanceQuadrantSignal],
) -> list[ContentPriorityRecommendation]:
    recommendations: list[ContentPriorityRecommendation] = []

    for item in sorted(quick_wins, key=lambda x: x.opportunity_score or 0, reverse=True)[:3]:
        recommendations.append(
            ContentPriorityRecommendation(
                title=f"Quick win: {item.keyword}",
                reason=f"Position {item.position:.1f} with {item.impressions} impressions.",
                action="refresh_existing_article",
                priority=item.priority,
                score=item.opportunity_score or 0,
                source="quick_win",
            )
        )

    for item in sorted(competitor_gaps, key=lambda x: x.opportunity_score or 0, reverse=True)[:3]:
        recommendations.append(
            ContentPriorityRecommendation(
                title=f"Gap: {item.keyword}",
                reason=f"{item.competitor} ranks #{item.competitor_position:.1f} and we do not.",
                action="create_new_article",
                priority=item.priority,
                score=item.opportunity_score or 0,
                source="competitor_gap",
            )
        )

    for item in sorted(performance_matrix, key=lambda x: (_priority_rank(x.priority), x.trend_percent))[:3]:
        recommendations.append(
            ContentPriorityRecommendation(
                title=f"{item.category}: {item.title}",
                reason=f"{item.monthly_pageviews} monthly pageviews at position {item.avg_position:.1f}.",
                action=item.action,
                priority=item.priority,
                score=abs(item.trend_percent),
                source="performance_matrix",
            )
        )

    return recommendations


def _summary(
    quick_wins: list[QuickWinSignal],
    competitor_gaps: list[CompetitorGapSignal],
    performance_matrix: list[PerformanceQuadrantSignal],
) -> str:
    return (
        f"{len(quick_wins)} quick wins, {len(competitor_gaps)} competitor gaps, "
        f"{len(performance_matrix)} performance rows"
    )


def _priority_rank(priority: PriorityLevel) -> int:
    return {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(priority, 4)
