from app.schemas.agents import AgentRole, IntegrationHealthSummary
from app.schemas.workflow import (
    ContentWorkflowExecutionPlan,
    ContentWorkflowExecutionRequest,
    ContentWorkflowExecutionTask,
    ContentWorkflowPlan,
    WorkflowExecutionRetryPolicy,
    WorkflowStepStatus,
)


DOCTRINE_SOURCES = [
    "Google Search Central: helpful content and structured guidance",
    "ericosiu/ai-marketing-skills: content-quality, humanizer, SEO ops",
    "TheCraigHewitt/seomachine: research -> write -> optimize -> performance-review",
]

REQUIRED_INTEGRATIONS = ["shopify", "search_console", "queue", "storage"]


def build_content_workflow_execution_plan(
    request: ContentWorkflowExecutionRequest,
    workflow_plan: ContentWorkflowPlan,
    integration_health: IntegrationHealthSummary,
) -> ContentWorkflowExecutionPlan:
    idempotency_key = request.idempotency_key or _build_idempotency_key(request, workflow_plan)
    runtime_blockers = _runtime_blockers(integration_health, workflow_plan)
    tasks = _execution_tasks(workflow_plan, integration_health, runtime_blockers)
    ready_task_count = sum(1 for task in tasks if task.status == WorkflowStepStatus.ready)
    pending_task_count = sum(1 for task in tasks if task.status == WorkflowStepStatus.pending)
    blocked_task_count = sum(1 for task in tasks if task.status == WorkflowStepStatus.blocked)
    required_blocked_task_count = sum(
        1 for task in tasks if task.status == WorkflowStepStatus.blocked and not _is_deferred_task(task)
    )

    runtime_status = "ready"
    if required_blocked_task_count > 0:
        runtime_status = "blocked"
    elif pending_task_count > 0 or blocked_task_count > 0:
        runtime_status = "degraded"

    return ContentWorkflowExecutionPlan(
        mode=workflow_plan.mode,
        topic=workflow_plan.topic,
        primary_keyword=workflow_plan.primary_keyword,
        publish_policy=workflow_plan.publish_policy,
        idempotency_key=idempotency_key,
        runtime_status=runtime_status,
        summary=_execution_summary(workflow_plan, tasks, runtime_blockers),
        next_step=_execution_next_step(workflow_plan, tasks, runtime_blockers),
        active_task_id=_active_task_id(tasks),
        ready_task_count=ready_task_count,
        pending_task_count=pending_task_count,
        blocked_task_count=blocked_task_count,
        tasks=tasks,
        workflow_blockers=list(workflow_plan.blockers),
        runtime_blockers=runtime_blockers,
        integration_health=integration_health,
        required_integrations=REQUIRED_INTEGRATIONS,
        doctrine_sources=DOCTRINE_SOURCES,
    )


def _build_idempotency_key(
    request: ContentWorkflowExecutionRequest,
    workflow_plan: ContentWorkflowPlan,
) -> str:
    source = request.source_id or request.topic or request.primary_keyword or workflow_plan.topic
    mode = "repair" if request.existing_article_id else "new"
    return f"{request.organization_id}:{request.store_id}:{mode}:{source}:{request.locale}"


def _runtime_blockers(
    integration_health: IntegrationHealthSummary,
    workflow_plan: ContentWorkflowPlan,
) -> list[str]:
    blockers: list[str] = []
    blocking_keys = {
        integration.key
        for integration in integration_health.integrations
        if integration.status == "blocked" and not _is_optional_integration(integration.key)
    }
    if blocking_keys:
        blockers.extend(
            [
                f"{integration.label} is {integration.status}: {integration.next_step}"
                for integration in integration_health.integrations
                if integration.status != "ready" and integration.key in blocking_keys
            ]
        )
    if not workflow_plan.workflow:
        blockers.append("workflow_empty")
    return blockers


def _execution_tasks(
    workflow_plan: ContentWorkflowPlan,
    integration_health: IntegrationHealthSummary,
    runtime_blockers: list[str],
) -> list[ContentWorkflowExecutionTask]:
    integration_map = {item.key: item for item in integration_health.integrations}
    tasks: list[ContentWorkflowExecutionTask] = []
    previous_task_id: str | None = None
    for index, step in enumerate(workflow_plan.workflow, start=1):
        required_integrations = _required_integrations_for_role(step.agent_role)
        blocking_reasons = list(workflow_plan.blockers if step.status == WorkflowStepStatus.blocked else [])
        for integration_key in required_integrations:
            integration = integration_map.get(integration_key)
            if integration and integration.status != "ready":
                blocking_reasons.append(integration.summary)
        if runtime_blockers and step.key in {"draft", "publish_guard"}:
            blocking_reasons.extend(runtime_blockers)
        task_status = step.status
        if blocking_reasons:
            task_status = (
                WorkflowStepStatus.blocked
                if step.status != WorkflowStepStatus.completed
                else WorkflowStepStatus.completed
            )
        tasks.append(
            ContentWorkflowExecutionTask(
                id=f"{workflow_plan.mode}:{step.key}",
                stage_key=step.key,
                title=step.title,
                agent_role=step.agent_role,
                status=task_status,
                objective=step.objective,
                depends_on=[previous_task_id] if previous_task_id else [],
                required_inputs=step.required_inputs,
                required_integrations=required_integrations,
                output_artifacts=_output_artifacts_for_stage(step.key),
                quality_gate=step.quality_gate,
                retry_policy=_retry_policy_for_role(step.agent_role),
                blocking_reasons=_unique(blocking_reasons),
                handoff_note=_handoff_note(step.key, step.agent_role, workflow_plan),
                queue_position=index,
                estimated_minutes=_estimated_minutes(step.key),
            )
        )
        previous_task_id = tasks[-1].id
    return tasks


def _is_optional_integration(key: str) -> bool:
    return key == "search_console"


def _required_integrations_for_role(role: AgentRole) -> list[str]:
    if role == AgentRole.publisher_guard:
        return ["shopify", "storage", "queue"]
    if role == AgentRole.growth_analyst:
        return ["search_console", "storage"]
    if role in {AgentRole.writer, AgentRole.shopping_guide_editor, AgentRole.image_director}:
        return ["queue", "storage"]
    if role == AgentRole.fact_checker:
        return ["storage"]
    return ["storage"]


def _retry_policy_for_role(role: AgentRole) -> WorkflowExecutionRetryPolicy:
    if role == AgentRole.publisher_guard:
        return WorkflowExecutionRetryPolicy(
            max_attempts=1,
            backoff_strategy="fixed",
            initial_delay_seconds=300,
            manual_review_after_failures=True,
        )
    if role == AgentRole.growth_analyst:
        return WorkflowExecutionRetryPolicy(
            max_attempts=3,
            backoff_strategy="linear",
            initial_delay_seconds=180,
            manual_review_after_failures=True,
        )
    if role in {AgentRole.fact_checker, AgentRole.image_director}:
        return WorkflowExecutionRetryPolicy(
            max_attempts=2,
            backoff_strategy="fixed",
            initial_delay_seconds=90,
            manual_review_after_failures=True,
        )
    return WorkflowExecutionRetryPolicy()


def _output_artifacts_for_stage(stage_key: str) -> list[str]:
    mapping = {
        "research": ["research_brief", "keyword_evidence", "citation_candidates"],
        "keyword_strategy": ["keyword_plan", "cannibalization_warnings"],
        "topic_strategy": ["topic_angle", "funnel_strategy", "differentiation_rules"],
        "draft": ["article_html", "seo_title", "meta_description"],
        "fact_check": ["fact_check_report", "claim_risks", "citation_gaps"],
        "image_direction": ["cover_image_plan", "image_alt_text", "visual_constraints"],
        "expert_panel": ["expert_panel_score", "revision_brief"],
        "publish_guard": ["publish_decision", "next_action"],
        "performance_review": ["quick_wins", "refresh_tasks", "memory_updates"],
    }
    return mapping.get(stage_key, [])


def _handoff_note(stage_key: str, role: AgentRole, workflow_plan: ContentWorkflowPlan) -> str:
    if stage_key == "research":
        return f"Collect evidence for {workflow_plan.topic} before the next agent writes."
    if stage_key == "keyword_strategy":
        return "Use research_brief and recent_topics to refine search intent."
    if stage_key == "topic_strategy":
        return "Choose the angle and differentiation rules before drafting."
    if stage_key == "draft":
        return "Draft the article using the brief and evidence chain."
    if stage_key == "fact_check":
        return "Verify claims, citations, and links before expert review."
    if stage_key == "image_direction":
        return "Prepare image direction and alt text before publish guard."
    if stage_key == "expert_panel":
        return "Score the draft and prepare a revision brief before publish guard."
    if stage_key == "publish_guard":
        return "Only approve if SEO, links, citations, and canonical readiness pass."
    if stage_key == "performance_review":
        return "Read Search Console and convert impressions into refresh tasks."
    return f"Continue the {role.value} stage."


def _estimated_minutes(stage_key: str) -> int:
    return {
        "research": 25,
        "keyword_strategy": 15,
        "topic_strategy": 10,
        "draft": 60,
        "fact_check": 15,
        "image_direction": 10,
        "expert_panel": 20,
        "publish_guard": 10,
        "performance_review": 15,
    }.get(stage_key, 15)


def _execution_summary(
    workflow_plan: ContentWorkflowPlan,
    tasks: list[ContentWorkflowExecutionTask],
    runtime_blockers: list[str],
) -> str:
    ready = sum(1 for task in tasks if task.status == WorkflowStepStatus.ready)
    blocked = sum(1 for task in tasks if task.status == WorkflowStepStatus.blocked)
    if runtime_blockers:
        return (
            f"Execution plan prepared for {workflow_plan.topic}, but runtime blockers remain: "
            f"{', '.join(runtime_blockers)}."
        )
    if blocked > 0:
        return (
            f"Execution plan prepared for {workflow_plan.topic} with "
            f"{blocked} blocked task(s) and {ready} ready task(s)."
        )
    return f"Execution plan prepared for {workflow_plan.topic}; {ready} task(s) are ready to run."


def _execution_next_step(
    workflow_plan: ContentWorkflowPlan,
    tasks: list[ContentWorkflowExecutionTask],
    runtime_blockers: list[str],
) -> str:
    if runtime_blockers:
        return "Resolve runtime blockers before queueing the execution plan."
    first_ready = next((task for task in tasks if task.status == WorkflowStepStatus.ready), None)
    if first_ready:
        return f"Queue {first_ready.title} and hand it to {first_ready.agent_role.value}."
    first_blocked = next((task for task in tasks if task.status == WorkflowStepStatus.blocked), None)
    if first_blocked:
        return f"Unblock {first_blocked.title}."
    return workflow_plan.next_step


def _active_task_id(tasks: list[ContentWorkflowExecutionTask]) -> str | None:
    active = next((task for task in tasks if task.status == WorkflowStepStatus.ready), None)
    if active:
        return active.id
    active = next((task for task in tasks if task.status == WorkflowStepStatus.pending), None)
    return active.id if active else None


def _unique(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _is_deferred_task(task: ContentWorkflowExecutionTask) -> bool:
    return task.stage_key == "performance_review" and "search_console" in task.required_integrations
