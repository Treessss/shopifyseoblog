from __future__ import annotations

from dataclasses import dataclass

from app.domain.agents.registry import default_agent_registry
from app.schemas.agents import AgentCenterSnapshot, AgentDescriptor, AgentRole, AgentStatus
from app.schemas.workflow import ContentWorkflowPlan, WorkflowStepStatus


DOCTRINE_SOURCES = [
    "Google Search Central: people-first helpful content",
    "ericosiu/ai-marketing-skills: humanizer, content quality, SEO ops",
    "TheCraigHewitt/seomachine: research -> plan -> write -> optimize -> performance review",
]


@dataclass(slots=True)
class DerivedAgentState:
    status: AgentStatus
    display_state: str
    is_active: bool
    state_reason: str
    current_step: str | None
    next_step: str | None
    open_tasks: int


def build_agent_center_snapshot_from_plan(plan: ContentWorkflowPlan) -> AgentCenterSnapshot:
    registry = {agent.role: agent for agent in default_agent_registry()}
    ordered_roles = _ordered_roles()
    active_step_index = _focus_step_index(plan.workflow)

    agents = [
        _agent_from_role(index, role, registry[role], plan, active_step_index)
        for index, role in enumerate(ordered_roles, start=1)
    ]

    total_steps = max(1, len(plan.workflow))
    completed_agents_total = sum(1 for agent in agents if agent.display_state == "complete")
    running_agents_total = sum(1 for agent in agents if agent.status == AgentStatus.running)
    blocked_agents_total = sum(1 for agent in agents if agent.status == AgentStatus.blocked)
    queued_agents_total = sum(1 for agent in agents if agent.display_state == "queued")
    active = next((agent for agent in agents if agent.is_active), None)
    ready_steps = sum(1 for step in plan.workflow if step.status == WorkflowStepStatus.ready)

    return AgentCenterSnapshot(
        workflow=[step.key for step in plan.workflow],
        agents=agents,
        next_action=_next_action(plan, active),
        warnings=_warnings(plan, active, queued_agents_total, blocked_agents_total),
        active_stage=active.stage if active else None,
        active_agent_role=active.role if active else None,
        active_agent_name=active.name if active else None,
        orchestration_mode=plan.mode,
        evidence_total=sum(agent.evidence_count for agent in agents),
        open_tasks_total=sum(agent.open_tasks for agent in agents),
        queued_agents_total=queued_agents_total,
        running_agents_total=running_agents_total,
        blocked_agents_total=blocked_agents_total,
        completed_agents_total=completed_agents_total,
        workflow_completion=round((ready_steps / total_steps) * 100, 1),
        doctrine_sources=DOCTRINE_SOURCES,
    )


def build_bootstrap_agent_center_snapshot() -> AgentCenterSnapshot:
    agents = []
    for index, agent in enumerate(default_agent_registry(), start=1):
        agents.append(
            AgentDescriptor(
                **{
                    **agent.model_dump(),
                    "sequence_index": index,
                    "queue_position": index,
                    "is_active": False,
                    "display_state": "bootstrap",
                    "status": AgentStatus.idle,
                    "state_reason": "Waiting for a content workflow request.",
                    "current_step": "Waiting for a content workflow request.",
                    "next_step": "Create a workflow plan from store, topic, links, references, and Search Console context.",
                    "doctrine_sources": DOCTRINE_SOURCES,
                }
            )
        )

    return AgentCenterSnapshot(
        agents=agents,
        next_action="Create a content workflow plan so Python can orchestrate the specialist agents.",
        warnings=[
            "Python owns planning and quality doctrine now; queue execution is still being migrated from the Next.js worker.",
            "Use the workflow-plan endpoint for live blockers, evidence counts, queue order, and next action.",
        ],
        active_stage=None,
        active_agent_role=None,
        active_agent_name=None,
        orchestration_mode="bootstrap",
        evidence_total=0,
        open_tasks_total=len(agents),
        queued_agents_total=len(agents),
        running_agents_total=0,
        blocked_agents_total=0,
        completed_agents_total=0,
        workflow_completion=0.0,
        doctrine_sources=DOCTRINE_SOURCES,
    )


def _agent_from_role(
    sequence_index: int,
    role: AgentRole,
    base: AgentDescriptor,
    plan: ContentWorkflowPlan,
    active_step_index: int,
) -> AgentDescriptor:
    steps = [step for step in plan.workflow if step.agent_role == role]
    step_index = _step_index_for_role(plan.workflow, role)
    state = _derive_agent_state(steps, step_index, active_step_index, plan)
    first_step = steps[0] if steps else None

    return AgentDescriptor(
        role=base.role,
        name=base.name,
        status=state.status,
        responsibility=base.responsibility,
        sequence_index=sequence_index,
        queue_position=step_index + 1 if step_index >= 0 else sequence_index,
        is_active=state.is_active,
        display_state=state.display_state,
        stage=first_step.key if first_step else None,
        objective=first_step.objective if first_step else None,
        current_step=state.current_step,
        next_step=state.next_step,
        evidence_count=_evidence_count(steps),
        open_tasks=state.open_tasks,
        outputs=[output for step in steps for output in step.outputs],
        quality_gate=first_step.quality_gate if first_step else None,
        state_reason=state.state_reason,
        blockers=_blockers_for_role(role, plan),
        doctrine_sources=DOCTRINE_SOURCES,
    )


def _derive_agent_state(
    steps: list,
    step_index: int,
    active_step_index: int,
    plan: ContentWorkflowPlan,
) -> DerivedAgentState:
    first_step = steps[0] if steps else None
    if not first_step:
        return DerivedAgentState(
            status=AgentStatus.idle,
            display_state="queued",
            is_active=False,
            state_reason="No workflow step has been assigned to this agent yet.",
            current_step="Waiting for the next workflow assignment.",
            next_step=plan.next_step,
            open_tasks=0,
        )

    if first_step.status == WorkflowStepStatus.blocked:
        reason = _blocked_reason(first_step, plan)
        return DerivedAgentState(
            status=AgentStatus.blocked,
            display_state="blocked",
            is_active=step_index == active_step_index,
            state_reason=reason,
            current_step=f"Blocked at {first_step.title}.",
            next_step=reason,
            open_tasks=max(1, len(steps)),
        )

    if step_index == active_step_index:
        return DerivedAgentState(
            status=AgentStatus.running,
            display_state="active",
            is_active=True,
            state_reason=f"Currently executing {first_step.title}.",
            current_step=f"Working on {first_step.title}.",
            next_step=_active_next_step(first_step, plan),
            open_tasks=max(1, len(steps)),
        )

    if step_index < active_step_index:
        return DerivedAgentState(
            status=AgentStatus.passed,
            display_state="complete",
            is_active=False,
            state_reason=f"Completed {first_step.title} and moved past this stage.",
            current_step=f"Completed {first_step.title}.",
            next_step=plan.next_step,
            open_tasks=0,
        )

    return DerivedAgentState(
        status=AgentStatus.idle,
        display_state="queued",
        is_active=False,
        state_reason=f"Queued behind {plan.next_step}.",
        current_step=f"Waiting for {plan.next_step}",
        next_step=plan.next_step,
        open_tasks=max(1, len(steps)),
    )


def _evidence_count(steps: list) -> int:
    return sum(len(step.required_inputs) + len(step.outputs) for step in steps)


def _active_next_step(step, plan: ContentWorkflowPlan) -> str | None:
    if step.status == WorkflowStepStatus.blocked:
        return step.quality_gate or plan.next_step
    return f"Produce: {', '.join(step.outputs)}." if step.outputs else plan.next_step


def _next_action(plan: ContentWorkflowPlan, active: AgentDescriptor | None) -> str:
    if active and active.status == AgentStatus.blocked:
        return active.next_step or plan.next_step
    if active and active.current_step:
        return active.current_step
    return plan.next_step


def _blocked_reason(step, plan: ContentWorkflowPlan) -> str:
    blockers = ", ".join(plan.blockers)
    if blockers:
        return f"Blocked by: {blockers}."
    return step.quality_gate or f"Blocked at {step.title}."


def _step_index_for_role(workflow, role: AgentRole) -> int:
    for index, step in enumerate(workflow):
        if step.agent_role == role:
            return index
    return -1


def _focus_step_index(workflow) -> int:
    if not workflow:
        return 0

    blocked_index = next((index for index, step in enumerate(workflow) if step.status == WorkflowStepStatus.blocked), None)
    if blocked_index is not None:
        ready_before_block = next(
            (index for index, step in enumerate(workflow[:blocked_index]) if step.status == WorkflowStepStatus.ready),
            None,
        )
        if ready_before_block is not None:
            return ready_before_block
        pending_before_block = next(
            (index for index, step in enumerate(workflow[:blocked_index]) if step.status == WorkflowStepStatus.pending),
            None,
        )
        if pending_before_block is not None:
            return pending_before_block
        return blocked_index

    ready_index = next((index for index, step in enumerate(workflow) if step.status == WorkflowStepStatus.ready), None)
    if ready_index is not None:
        return ready_index

    pending_index = next((index for index, step in enumerate(workflow) if step.status == WorkflowStepStatus.pending), None)
    return pending_index if pending_index is not None else 0


def _warnings(
    plan: ContentWorkflowPlan,
    active: AgentDescriptor | None,
    queued_agents_total: int,
    blocked_agents_total: int,
) -> list[str]:
    warnings: list[str] = []
    if plan.blockers:
        warnings.append(f"Workflow blockers: {', '.join(plan.blockers)}.")
    if blocked_agents_total > 0:
        warnings.append(f"{blocked_agents_total} agent(s) are blocked and need input before the flow can continue.")
    if queued_agents_total > 0 and active:
        warnings.append(f"{queued_agents_total} agent(s) are queued behind {active.name}.")
    if plan.mode == "article_repair":
        warnings.append("Repair mode should preserve live article identity and use analyze-existing -> rewrite -> optimize.")
    warnings.append("Publishing remains guarded until Python queue and Shopify adapters are fully wired.")
    return warnings


def _blockers_for_role(role: AgentRole, plan: ContentWorkflowPlan) -> list[str]:
    if role == AgentRole.researcher:
        return [blocker for blocker in plan.blockers if blocker in {"topic", "internal_links", "external_references", "recent_topics"}]
    if role == AgentRole.keyword_planner:
        return [blocker for blocker in plan.blockers if blocker in {"topic", "recent_topics"}]
    if role in {AgentRole.writer, AgentRole.shopping_guide_editor, AgentRole.topic_strategist}:
        return [blocker for blocker in plan.blockers if blocker in {"topic", "internal_links", "external_references"}]
    if role == AgentRole.fact_checker:
        return [blocker for blocker in plan.blockers if blocker in {"external_references"}]
    if role == AgentRole.growth_analyst:
        return [blocker for blocker in plan.blockers if blocker == "search_console"]
    return []


def _ordered_roles() -> list[AgentRole]:
    return [
        AgentRole.researcher,
        AgentRole.keyword_planner,
        AgentRole.topic_strategist,
        AgentRole.shopping_guide_editor,
        AgentRole.fact_checker,
        AgentRole.image_director,
        AgentRole.seo_editor,
        AgentRole.publisher_guard,
        AgentRole.growth_analyst,
    ]
