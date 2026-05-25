from app.api.v1.routes.content import workflow_execution_plan
from app.core.config import Settings
from app.schemas.workflow import ContentWorkflowExecutionRequest
from app.services.workflow_execution import get_content_workflow_execution_plan


def test_workflow_execution_plan_blocks_when_runtime_is_not_configured() -> None:
    plan = get_content_workflow_execution_plan(
        ContentWorkflowExecutionRequest(
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

    assert plan.runtime_status == "blocked"
    assert plan.idempotency_key == "org_1:store_1:new:phone case buying guide:zh-CN"
    assert plan.blocked_task_count > 0
    assert plan.ready_task_count == 0
    assert "shopify" in plan.required_integrations
    assert "queue" in plan.required_integrations
    assert plan.integration_health.status == "blocked"
    assert plan.runtime_blockers
    assert plan.tasks[0].id == "new_article:research"
    assert plan.tasks[0].status == "blocked"
    assert plan.tasks[0].required_integrations == ["storage"]
    assert plan.tasks[3].required_integrations == ["queue", "storage"]
    assert plan.tasks[7].retry_policy.max_attempts == 1
    assert plan.next_step == "Resolve runtime blockers before queueing the execution plan."


def test_workflow_execution_plan_ready_when_evidence_and_runtime_are_ready() -> None:
    plan = get_content_workflow_execution_plan(
        ContentWorkflowExecutionRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
            available_internal_links=4,
            available_external_references=2,
            recent_topic_count=5,
            search_console_connected=True,
            idempotency_key="custom-key",
        ),
        Settings(
            shopify_store_domain="example.myshopify.com",
            shopify_admin_access_token="shpat_test",
            google_search_console_property_url="https://example.com/",
            google_client_id="client",
            google_client_secret="secret",
            redis_url="redis://localhost:6379",
            database_url="postgres://local",
        ),
    )

    assert plan.runtime_status == "ready"
    assert plan.idempotency_key == "custom-key"
    assert plan.blocked_task_count == 0
    assert plan.pending_task_count == 0
    assert plan.ready_task_count == 9
    assert plan.active_task_id == "new_article:research"
    assert plan.tasks[-1].required_integrations == ["search_console", "storage"]
    assert plan.next_step == "Queue Research and evidence collection and hand it to researcher."


def test_workflow_execution_plan_degrades_but_creates_without_search_console() -> None:
    plan = get_content_workflow_execution_plan(
        ContentWorkflowExecutionRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
            available_internal_links=4,
            available_external_references=2,
            recent_topic_count=5,
            search_console_connected=False,
        ),
        Settings(
            shopify_store_domain="example.myshopify.com",
            shopify_admin_access_token="shpat_test",
            redis_url="redis://localhost:6379",
            database_url="postgres://local",
        ),
    )

    assert plan.runtime_status == "degraded"
    assert plan.ready_task_count == 8
    assert plan.blocked_task_count == 1
    assert plan.tasks[-1].stage_key == "performance_review"
    assert plan.tasks[-1].status == "blocked"
    assert plan.next_step == "Queue Research and evidence collection and hand it to researcher."


def test_workflow_execution_plan_route_handler() -> None:
    plan = workflow_execution_plan(
        ContentWorkflowExecutionRequest(
            organization_id="org_1",
            store_id="store_1",
            topic="phone case buying guide",
            primary_keyword="phone case",
        ),
        Settings(redis_url="redis://localhost:6379"),
    )

    assert plan.runtime_status == "blocked"
    assert plan.workflow_blockers
    assert plan.tasks[1].status == "blocked"
