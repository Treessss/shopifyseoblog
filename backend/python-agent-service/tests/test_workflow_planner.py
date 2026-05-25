from app.core.config import Settings
from app.schemas.workflow import ContentWorkflowRequest
from app.services.workflow_planner import build_content_workflow_plan


def test_workflow_plan_exposes_multi_agent_sequence() -> None:
    plan = build_content_workflow_plan(
        ContentWorkflowRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
            available_internal_links=4,
            available_external_references=2,
            recent_topic_count=5,
            search_console_connected=True,
        ),
        Settings(),
    )

    assert plan.mode == "new_article"
    assert [step.key for step in plan.workflow] == [
        "research",
        "keyword_strategy",
        "topic_strategy",
        "draft",
        "fact_check",
        "image_direction",
        "expert_panel",
        "publish_guard",
        "performance_review",
    ]
    assert not plan.blockers
    assert all(step.status == "ready" for step in plan.workflow)
    assert plan.workflow[2].agent_role == "topic_strategist"
    assert plan.workflow[3].agent_role == "shopping_guide_editor"
    assert plan.workflow[4].agent_role == "fact_checker"
    assert plan.workflow[5].agent_role == "image_director"
    assert plan.minimum_expert_panel_score == 90


def test_workflow_plan_blocks_when_evidence_is_missing() -> None:
    plan = build_content_workflow_plan(
        ContentWorkflowRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
        ),
        Settings(),
    )

    assert "internal_links" in plan.blockers
    assert "external_references" in plan.blockers
    assert plan.next_step == "Sync Shopify products, collections, and blog articles so internal links can be planned."
    assert plan.workflow[0].status == "ready"
    assert plan.workflow[1].status == "blocked"
    assert plan.workflow[2].status == "pending"
    assert plan.workflow[3].status == "pending"
    assert plan.workflow[4].status == "pending"
    assert plan.workflow[-1].status == "blocked"


def test_workflow_plan_allows_creation_without_search_console() -> None:
    plan = build_content_workflow_plan(
        ContentWorkflowRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
            available_internal_links=4,
            available_external_references=2,
            recent_topic_count=5,
            search_console_connected=False,
        ),
        Settings(),
    )

    assert "search_console" in plan.blockers
    assert all(step.status == "ready" for step in plan.workflow[:-1])
    assert plan.workflow[-1].key == "performance_review"
    assert plan.workflow[-1].status == "blocked"
    assert plan.next_step == "Run the content workflow now; connect Search Console later for post-publish performance review."
