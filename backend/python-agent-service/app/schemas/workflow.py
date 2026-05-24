from enum import StrEnum

from pydantic import BaseModel, Field

from app.schemas.agents import AgentRole


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
