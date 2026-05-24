from app.domain.seo.board import build_content_priority_board
from app.domain.seo.strategy import CompetitorGapSignal, PerformanceQuadrantSignal, QuickWinSignal
from app.services.seo_board import get_content_priority_board


def test_seo_board_prioritizes_quick_wins_and_gaps() -> None:
    board = build_content_priority_board(
        quick_wins=[
            QuickWinSignal(
                keyword="shopify seo checklist",
                position=12.2,
                impressions=900,
                clicks=24,
                ctr=0.026,
                opportunity_score=91,
                priority="high",
            )
        ],
        competitor_gaps=[
            CompetitorGapSignal(
                keyword="shopify blog examples",
                competitor="competitor.example",
                competitor_position=5,
                search_volume=700,
                opportunity_score=84,
                priority="medium",
            )
        ],
        performance_matrix=[
            PerformanceQuadrantSignal(
                path="/blog/shopify-seo",
                title="Shopify SEO",
                category="Underperformer",
                monthly_pageviews=1000,
                avg_position=10.8,
                trend_percent=-18.0,
                action="refresh_existing_article",
                priority="high",
            )
        ],
    )

    assert board.quality_score >= 30
    assert board.recommendations[0].source == "quick_win"
    assert "quick wins" in board.summary


def test_seo_board_service_returns_bootstrap_strategy() -> None:
    board = get_content_priority_board()

    assert board.recommendations
    assert board.quick_wins
    assert board.summary
