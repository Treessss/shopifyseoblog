from app.domain.seo.board import build_content_priority_board
from app.domain.seo.strategy import (
    CompetitorGapSignal,
    PerformanceQuadrantSignal,
    QuickWinSignal,
)
from app.schemas.seo import ContentPriorityBoard


def get_content_priority_board() -> ContentPriorityBoard:
    quick_wins = [
        QuickWinSignal(
            keyword="shopify seo quick win",
            position=13.4,
            impressions=1240,
            clicks=38,
            ctr=0.031,
            search_intent="Commercial investigation",
            opportunity_score=87,
            priority="high",
        )
    ]
    competitor_gaps = [
        CompetitorGapSignal(
            keyword="best shopify blog strategy",
            competitor="example.com",
            competitor_position=7.0,
            search_volume=520,
            difficulty=42,
            search_intent="Informational",
            opportunity_score=74,
            priority="medium",
        )
    ]
    performance_matrix = [
        PerformanceQuadrantSignal(
            path="/blog/shopify-seo",
            title="Shopify SEO Guide",
            category="Underperformer",
            monthly_pageviews=1200,
            avg_position=11.8,
            trend_percent=-12.5,
            action="Refresh title and intro",
            priority="high",
        )
    ]

    return build_content_priority_board(
        quick_wins=quick_wins,
        competitor_gaps=competitor_gaps,
        performance_matrix=performance_matrix,
    )
