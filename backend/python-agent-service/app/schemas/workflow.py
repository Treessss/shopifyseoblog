from enum import StrEnum

from pydantic import BaseModel, Field

from app.schemas.agents import AgentRole, IntegrationHealthSummary


class SourceType(StrEnum):
    product = "product"
    collection = "collection"
    manual_topic = "manual_topic"


class PublishPolicy(StrEnum):
    auto_when_qualified = "auto_when_qualified"
    manual_review = "manual_review"
    direct = "direct"


class WorkflowStepStatus(StrEnum):
    pending = "pending"
    ready = "ready"
    blocked = "blocked"
    completed = "completed"


class ContentWorkflowRequest(BaseModel):
    organization_id: str
    store_id: str
    locale: str = "zh-CN"
    source_type: SourceType = SourceType.manual_topic
    source_id: str | None = None
    topic: str | None = None
    primary_keyword: str | None = None
    publish_policy: PublishPolicy = PublishPolicy.manual_review
    target_word_count: int = Field(default=1600, ge=600, le=5000)
    existing_article_id: str | None = None
    repair_reason: str | None = None
    available_internal_links: int = 0
    available_external_references: int = 0
    recent_topic_count: int = 0
    search_console_connected: bool = False


class ContentWorkflowStep(BaseModel):
    key: str
    title: str
    agent_role: AgentRole
    status: WorkflowStepStatus
    objective: str
    required_inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    quality_gate: str | None = None


class ContentWorkflowPlan(BaseModel):
    mode: str
    topic: str
    primary_keyword: str
    workflow: list[ContentWorkflowStep]
    minimum_publish_score: int
    minimum_expert_panel_score: int
    publish_policy: PublishPolicy
    blockers: list[str] = Field(default_factory=list)
    next_step: str


class WorkflowExecutionRetryPolicy(BaseModel):
    max_attempts: int = Field(default=2, ge=1, le=10)
    backoff_strategy: str = "exponential"
    initial_delay_seconds: int = Field(default=120, ge=0, le=3600)
    manual_review_after_failures: bool = True


class ContentWorkflowExecutionRequest(ContentWorkflowRequest):
    idempotency_key: str | None = None


class ContentWorkflowExecutionTask(BaseModel):
    id: str
    stage_key: str
    title: str
    agent_role: AgentRole
    status: WorkflowStepStatus
    objective: str
    depends_on: list[str] = Field(default_factory=list)
    required_inputs: list[str] = Field(default_factory=list)
    required_integrations: list[str] = Field(default_factory=list)
    output_artifacts: list[str] = Field(default_factory=list)
    quality_gate: str | None = None
    retry_policy: WorkflowExecutionRetryPolicy
    blocking_reasons: list[str] = Field(default_factory=list)
    handoff_note: str
    queue_position: int = Field(default=0, ge=0)
    estimated_minutes: int = Field(default=0, ge=0, le=480)


class ContentWorkflowExecutionPlan(BaseModel):
    mode: str
    topic: str
    primary_keyword: str
    publish_policy: PublishPolicy
    idempotency_key: str
    runtime_status: str
    summary: str
    next_step: str
    active_task_id: str | None = None
    ready_task_count: int = 0
    pending_task_count: int = 0
    blocked_task_count: int = 0
    tasks: list[ContentWorkflowExecutionTask] = Field(default_factory=list)
    workflow_blockers: list[str] = Field(default_factory=list)
    runtime_blockers: list[str] = Field(default_factory=list)
    integration_health: IntegrationHealthSummary
    required_integrations: list[str] = Field(default_factory=list)
    doctrine_sources: list[str] = Field(default_factory=list)
