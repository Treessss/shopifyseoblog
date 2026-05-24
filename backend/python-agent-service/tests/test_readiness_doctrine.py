from app.api.v1.routes.content import readiness_doctrine
from app.services.readiness_doctrine import get_content_readiness_doctrine


def test_readiness_doctrine_defines_three_ordered_stages() -> None:
    doctrine = get_content_readiness_doctrine()

    assert doctrine.default_sequence == ["publish_ready", "index_ready", "rank_ready"]
    assert [stage.key for stage in doctrine.stages] == doctrine.default_sequence
    assert doctrine.stages[0].label == "Publish-ready"
    assert doctrine.stages[1].label == "Index-ready"
    assert doctrine.stages[2].label == "Rank-ready"


def test_rank_ready_requires_search_console_evidence() -> None:
    doctrine = get_content_readiness_doctrine()
    rank_ready = next(stage for stage in doctrine.stages if stage.key == "rank_ready")

    evidence_text = " ".join(rank_ready.evidence_required + rank_ready.required_checks + [rank_ready.summary])
    assert "Search Console" in evidence_text
    assert "average position" in evidence_text
    assert "CTR" in evidence_text
    assert "不能保证" in doctrine.no_guarantee_notice


def test_readiness_doctrine_sources_cover_google_ai_marketing_and_seomachine() -> None:
    doctrine = get_content_readiness_doctrine()
    source_text = " ".join(doctrine.doctrine_sources)

    assert "Google Search Central" in source_text
    assert "ericosiu/ai-marketing-skills" in source_text
    assert "TheCraigHewitt/seomachine" in source_text


def test_readiness_doctrine_route_handler() -> None:
    doctrine = readiness_doctrine()

    assert doctrine.default_sequence == ["publish_ready", "index_ready", "rank_ready"]
    assert doctrine.stages[0].agent_roles
