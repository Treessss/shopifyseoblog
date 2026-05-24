from enum import StrEnum

from pydantic import BaseModel, Field

from app.schemas.agents import AgentRole
from app.schemas.seo import PriorityLevel


class QualityCheck(BaseModel):
    key: str
    label: str
    passed: bool
    detail: str


class ArticleQualityInput(BaseModel):
    title: str
    body_html: str
    summary: str | None = None
    primary_keyword: str | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    seo_score: int | None = None
    ai_search_score: int | None = None
    editorial_score: int | None = None
    expert_panel_score: int | None = None
    has_canonical_url: bool = False
    has_internal_links: bool = False
    has_external_references: bool = False
    has_faq: bool = False
    has_decision_support: bool = False
    has_images: bool = False
    image_alt_texts: list[str] = Field(default_factory=list)
    quality_passed: bool = False
    brand_voice_banned_words: list[str] = Field(default_factory=list)


class ArticleQualityGate(BaseModel):
    publish_ready: bool
    index_ready: bool
    score: int = Field(ge=0, le=100)
    checks: list[QualityCheck]
    next_step: str
    humanizer_score: int = Field(ge=0, le=100)
    humanizer_signals: list[str] = Field(default_factory=list)
    humanizer_recommendations: list[str] = Field(default_factory=list)
    helpful_content_score: int = Field(ge=0, le=100)
    helpful_content_signals: list[str] = Field(default_factory=list)
    helpful_content_recommendations: list[str] = Field(default_factory=list)
    doctrine_sources: list[str] = Field(default_factory=list)


class ArticleRepairMode(StrEnum):
    pre_publish_repair = "pre_publish_repair"
    publish_and_index = "publish_and_index"
    post_publish_refresh = "post_publish_refresh"


class ArticleRepairTask(BaseModel):
    id: str
    agent_role: AgentRole
    priority: PriorityLevel = PriorityLevel.medium
    issue: str
    instruction: str
    acceptance_check: str
    source_check_key: str | None = None
    depends_on: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)


class ArticleRepairPlanInput(ArticleQualityInput):
    article_id: str | None = None
    canonical_url: str | None = None
    status: str | None = None
    repair_reason: str | None = None


class ArticleRepairPlan(BaseModel):
    article_id: str | None = None
    canonical_url: str | None = None
    status: str | None = None
    repair_reason: str | None = None
    mode: ArticleRepairMode
    summary: str
    next_step: str
    blockers: list[str] = Field(default_factory=list)
    quality_gate: ArticleQualityGate
    tasks: list[ArticleRepairTask] = Field(default_factory=list)
