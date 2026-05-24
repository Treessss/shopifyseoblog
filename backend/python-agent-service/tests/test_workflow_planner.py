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
        "draft",
        "expert_panel",
        "publish_guard",
        "performance_review",
    ]
    assert not plan.blockers
    assert plan.workflow[0].status == plan.workflow[1].status == plan.workflow[2].status
    assert plan.workflow[3].status == plan.workflow[4].status == "ready"
    assert plan.workflow[5].status == "ready"
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
    assert plan.workflow[5].status == "blocked"
