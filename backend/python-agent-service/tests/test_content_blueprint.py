from app.api.v1.routes.content import article_blueprint
from app.schemas.agents import AgentRole
from app.services.content_blueprint import get_content_article_blueprint


def test_content_blueprint_has_expected_outline_and_sources() -> None:
    blueprint = get_content_article_blueprint()

    assert blueprint.article_type == "Shopify SEO blog article"
    assert [section.key for section in blueprint.outline] == [
        "answer_first_intro",
        "verified_facts",
        "decision_support",
        "faq_section",
        "publish_check",
        "post_publish_review",
    ]
    assert blueprint.outline[0].agent_role == AgentRole.writer
    assert blueprint.outline[1].agent_role == AgentRole.researcher
    assert blueprint.outline[-1].agent_role == AgentRole.growth_analyst
    assert "Title and meta" in " ".join(blueprint.seo_rules)
    assert "banned AI vocabulary" in " ".join(blueprint.humanizer_rules)
    assert "publish-ready" in " ".join(blueprint.publish_rules)
    assert "click here" in " ".join(blueprint.anti_patterns).lower()
    assert any("ai-marketing-skills" in source for source in blueprint.doctrine_sources)
    assert any("seomachine" in source for source in blueprint.doctrine_sources)


def test_content_blueprint_route_handler() -> None:
    blueprint = article_blueprint()

    assert blueprint.target_length == "1500-2200 words"
    assert blueprint.outline[2].must_have
    assert blueprint.outline[4].quality_gate is not None
