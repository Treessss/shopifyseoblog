from enum import StrEnum

from pydantic import BaseModel, Field


class AgentRole(StrEnum):
    researcher = "researcher"
    keyword_planner = "keyword_planner"
    writer = "writer"
    seo_editor = "seo_editor"
    publisher_guard = "publisher_guard"
    growth_analyst = "growth_analyst"


class AgentStatus(StrEnum):
    idle = "idle"
    running = "running"
    blocked = "blocked"
    passed = "passed"
    failed = "failed"


class AgentDescriptor(BaseModel):
    role: AgentRole
    name: str
    status: AgentStatus = AgentStatus.idle
    responsibility: str
    sequence_index: int = 0
    queue_position: int = 0
    is_active: bool = False
    display_state: str | None = None
    current_step: str | None = None
    next_step: str | None = None
    state_reason: str | None = None
    evidence_count: int = 0
    open_tasks: int = 0
    stage: str | None = None
    objective: str | None = None
    outputs: list[str] = Field(default_factory=list)
    quality_gate: str | None = None
    blockers: list[str] = Field(default_factory=list)
    doctrine_sources: list[str] = Field(default_factory=list)


class AgentCenterSnapshot(BaseModel):
    workflow: list[str] = Field(
        default_factory=lambda: ["research", "brief", "draft", "quality_gate", "publish", "review"]
    )
    agents: list[AgentDescriptor]
    next_action: str
    warnings: list[str] = Field(default_factory=list)
    active_stage: str | None = None
    active_agent_role: AgentRole | None = None
    active_agent_name: str | None = None
    orchestration_mode: str = "bootstrap"
    evidence_total: int = 0
    open_tasks_total: int = 0
    queued_agents_total: int = 0
    running_agents_total: int = 0
    blocked_agents_total: int = 0
    completed_agents_total: int = 0
    workflow_completion: float = 0.0
    doctrine_sources: list[str] = Field(default_factory=list)
