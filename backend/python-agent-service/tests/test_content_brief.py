from app.api.v1.routes.content import article_brief
from app.core.config import Settings
from app.schemas.workflow import ContentWorkflowRequest, SourceType
from app.services.content_brief import get_content_article_brief


def test_content_brief_has_title_options_and_section_plan() -> None:
    brief = get_content_article_brief(
        ContentWorkflowRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
            source_type=SourceType.manual_topic,
            available_internal_links=3,
            available_external_references=2,
            recent_topic_count=4,
            search_console_connected=True,
        ),
        Settings(),
    )

    assert brief.mode == "new_article"
    assert brief.topic == "phone case buying guide"
    assert brief.title_options
    assert brief.meta_title_options
    assert brief.meta_description_options
    assert brief.h1 == brief.title_options[0]
    assert brief.sections[0].heading == "Quick answer"
    assert brief.sections[-1].heading == "After launch"
    assert "Search Console" in " ".join(brief.external_reference_plan)
    assert "publish-ready" in " ".join(brief.publish_rules)


def test_content_brief_route_handler() -> None:
    brief = article_brief(
        ContentWorkflowRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
            source_type=SourceType.product,
            available_internal_links=0,
            available_external_references=0,
            recent_topic_count=0,
            search_console_connected=False,
        ),
        Settings(),
    )

    assert brief.blockers
    assert "buyer's guide" in brief.title_options[0].lower() or "buyer guide" in brief.title_options[0].lower()
