from app.core.config import Settings
from app.schemas.agents import AgentRole
from app.schemas.workflow import (
    ContentWorkflowPlan,
    ContentWorkflowRequest,
    ContentWorkflowStep,
    WorkflowStepStatus,
)


def build_content_workflow_plan(request: ContentWorkflowRequest, settings: Settings) -> ContentWorkflowPlan:
    topic = request.topic or request.primary_keyword or "Shopify SEO content opportunity"
    primary_keyword = request.primary_keyword or topic
    blockers = _workflow_blockers(request)
    mode = "article_repair" if request.existing_article_id else "new_article"
    research_status = _step_status(blockers, blocked_by=["topic"])
    keyword_status = _step_status(blockers, blocked_by=["topic", "recent_topics"])
    draft_status = _step_status(blockers, blocked_by=["topic", "internal_links", "external_references"])
    expert_panel_status = (
        WorkflowStepStatus.ready if draft_status != WorkflowStepStatus.blocked and keyword_status == WorkflowStepStatus.ready else WorkflowStepStatus.pending
    )
    publish_guard_status = WorkflowStepStatus.ready if expert_panel_status == WorkflowStepStatus.ready else WorkflowStepStatus.pending
    performance_review_status = (
        WorkflowStepStatus.ready
        if request.search_console_connected and publish_guard_status == WorkflowStepStatus.ready
        else WorkflowStepStatus.blocked
        if not request.search_console_connected
        else WorkflowStepStatus.pending
    )
    workflow = [
        ContentWorkflowStep(
            key="research",
            title="Research and evidence collection",
            agent_role=AgentRole.researcher,
            status=research_status,
            objective="Collect Shopify source facts, trend signals, internal links, and approved external references.",
            required_inputs=["store_id", "source_type", "topic or primary_keyword"],
            outputs=["research_brief", "keyword_evidence", "citation_candidates"],
            quality_gate="No unsupported claims; separate verified facts from unknowns.",
        ),
        ContentWorkflowStep(
            key="keyword_strategy",
            title="Keyword and intent strategy",
            agent_role=AgentRole.keyword_planner,
            status=keyword_status if research_status == WorkflowStepStatus.ready else WorkflowStepStatus.pending,
            objective="Map primary keyword, secondary keywords, long tails, and search intent.",
            required_inputs=["research_brief", "recent_topics"],
            outputs=["keyword_plan", "cannibalization_warnings"],
            quality_gate="Primary keyword must fit one clear search intent.",
        ),
        ContentWorkflowStep(
            key="draft",
            title="Human-like article draft",
            agent_role=AgentRole.writer,
            status=draft_status if keyword_status == WorkflowStepStatus.ready else WorkflowStepStatus.pending,
            objective="Draft a buyer-useful article with answer-first intro, sections, FAQ, and decision support.",
            required_inputs=["keyword_plan", "research_brief", "brand_voice"],
            outputs=["article_html", "seo_title", "meta_description"],
            quality_gate="Avoid generic AI patterns, title formulas, unsupported superlatives, and thin examples.",
        ),
        ContentWorkflowStep(
            key="expert_panel",
            title="Expert panel review",
            agent_role=AgentRole.seo_editor,
            status=expert_panel_status if draft_status == WorkflowStepStatus.ready and keyword_status == WorkflowStepStatus.ready else WorkflowStepStatus.pending,
            objective="Score the draft through SEO, humanizer, brand, and shopper-usefulness lenses.",
            required_inputs=["article_html", "quality_report"],
            outputs=["expert_panel_score", "revision_brief"],
            quality_gate=f"Panel average must reach {settings.expert_panel_pass_score}+ before publish.",
        ),
        ContentWorkflowStep(
            key="publish_guard",
            title="Publish guard",
            agent_role=AgentRole.publisher_guard,
            status=publish_guard_status if expert_panel_status == WorkflowStepStatus.ready else WorkflowStepStatus.pending,
            objective="Allow publishing only when quality, SEO, links, citations, and Shopify requirements pass.",
            required_inputs=["quality_gate", "shopify_blog_target"],
            outputs=["publish_decision", "next_action"],
            quality_gate=f"SEO score must reach {settings.min_publish_seo_score}+ and required checks must pass.",
        ),
        ContentWorkflowStep(
            key="performance_review",
            title="Search Console performance loop",
            agent_role=AgentRole.growth_analyst,
            status=performance_review_status,
            objective="Use impressions, average position, CTR, and query gaps to create repair or new-campaign actions.",
            required_inputs=["canonical_url", "search_console_property"],
            outputs=["quick_wins", "refresh_tasks", "memory_updates"],
            quality_gate="Do not claim ranking improvement without post-publish performance evidence.",
        ),
    ]

    return ContentWorkflowPlan(
        mode=mode,
        topic=topic,
        primary_keyword=primary_keyword,
        workflow=workflow,
        minimum_publish_score=settings.min_publish_seo_score,
        minimum_expert_panel_score=settings.expert_panel_pass_score,
        publish_policy=request.publish_policy,
        blockers=blockers,
        next_step=_next_step(workflow, blockers),
    )


def _workflow_blockers(request: ContentWorkflowRequest) -> list[str]:
    blockers: list[str] = []
    if not (request.topic or request.primary_keyword):
        blockers.append("topic")
    if request.available_internal_links <= 0:
        blockers.append("internal_links")
    if request.available_external_references <= 0:
        blockers.append("external_references")
    if request.recent_topic_count <= 0:
        blockers.append("recent_topics")
    if not request.search_console_connected:
        blockers.append("search_console")
    return blockers


def _step_status(blockers: list[str], blocked_by: list[str]) -> WorkflowStepStatus:
    return WorkflowStepStatus.blocked if any(blocker in blockers for blocker in blocked_by) else WorkflowStepStatus.ready


def _next_step(workflow: list[ContentWorkflowStep], blockers: list[str]) -> str:
    if "topic" in blockers:
        return "Choose a topic or primary keyword before drafting."
    if "internal_links" in blockers:
        return "Sync Shopify products, collections, and blog articles so internal links can be planned."
    if "external_references" in blockers:
        return "Collect approved external references before publishing."
    if "search_console" in blockers:
        return "Connect Search Console before the performance review stage."
    first_blocked = next((step for step in workflow if step.status == WorkflowStepStatus.blocked), None)
    if first_blocked:
        return f"Unblock {first_blocked.title}."
    return "Run the workflow and keep the article in manual review until quality gates pass."
