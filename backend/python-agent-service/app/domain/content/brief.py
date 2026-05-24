from __future__ import annotations

from app.core.config import Settings
from app.domain.content.blueprint import build_content_article_blueprint
from app.domain.content.workflow import build_content_workflow_plan
from app.schemas.agents import AgentRole
from app.schemas.content import ContentArticleBrief, ContentArticleBriefSection
from app.schemas.workflow import ContentWorkflowRequest, SourceType


def build_content_article_brief(request: ContentWorkflowRequest, settings: Settings) -> ContentArticleBrief:
    blueprint = build_content_article_blueprint()
    workflow_plan = build_content_workflow_plan(request, settings)
    topic = (request.topic or request.primary_keyword or "Shopify SEO content opportunity").strip()
    primary_keyword = (request.primary_keyword or topic).strip()
    mode = "article_repair" if request.existing_article_id else "new_article"
    audience = _resolve_audience(request.source_type)
    search_intent = _resolve_search_intent(request.source_type)
    opening_angle = _resolve_opening_angle(request.source_type)
    title_options = _generate_title_options(request.source_type, topic, primary_keyword)
    meta_title_options = _generate_meta_title_options(title_options, primary_keyword)
    meta_description_options = _generate_meta_description_options(request.source_type, topic, primary_keyword, search_intent)

    sections = [
        ContentArticleBriefSection(
            key=section.key,
            heading=_section_heading(section.key, topic, primary_keyword),
            agent_role=section.agent_role,
            purpose=section.purpose,
            target_words=section.target_words,
            must_have=section.must_have,
            avoid=section.avoid,
        )
        for section in blueprint.outline
    ]

    faq_questions = _generate_faq_questions(request.source_type, topic, primary_keyword)
    internal_link_plan = _generate_internal_link_plan(request.available_internal_links)
    external_reference_plan = _generate_external_reference_plan(request.available_external_references, request.search_console_connected)

    return ContentArticleBrief(
        mode=mode,
        topic=topic,
        primary_keyword=primary_keyword,
        audience=audience,
        search_intent=search_intent,
        summary=(
            f"Write a {topic} article that answers the buyer's main question, "
            f"shows evidence, and stays aligned with the {search_intent.lower()} intent."
        ),
        opening_angle=opening_angle,
        title_options=title_options,
        meta_title_options=meta_title_options,
        meta_description_options=meta_description_options,
        h1=title_options[0],
        sections=sections,
        faq_questions=faq_questions,
        internal_link_plan=internal_link_plan,
        external_reference_plan=external_reference_plan,
        humanizer_notes=blueprint.humanizer_rules[:5],
        seo_rules=blueprint.seo_rules,
        publish_rules=blueprint.publish_rules,
        blockers=workflow_plan.blockers,
        next_step=workflow_plan.next_step,
        doctrine_sources=blueprint.doctrine_sources,
    )


def _resolve_audience(source_type: SourceType) -> str:
    if source_type == SourceType.product:
        return "Buyers comparing one product against alternatives."
    if source_type == SourceType.collection:
        return "Shoppers browsing a related product set."
    return "Readers looking for a practical buying guide."


def _resolve_search_intent(source_type: SourceType) -> str:
    if source_type == SourceType.product:
        return "Commercial / buyer decision"
    if source_type == SourceType.collection:
        return "Commercial comparison"
    return "Informational with buying signals"


def _resolve_opening_angle(source_type: SourceType) -> str:
    if source_type == SourceType.product:
        return "Lead with whether the product fits the use case and what trade-offs matter most."
    if source_type == SourceType.collection:
        return "Lead with how to choose the right option from the collection."
    return "Lead with the direct answer, then expand into evidence and practical trade-offs."


def _generate_title_options(source_type: SourceType, topic: str, primary_keyword: str) -> list[str]:
    if source_type == SourceType.product:
        return [
            f"Is {primary_keyword} Worth It? A Buyer Guide",
            f"What to Know Before Buying {topic}",
            f"{topic}: Practical Notes for Buyers",
        ]
    if source_type == SourceType.collection:
        return [
            f"How to Choose the Best {topic}",
            f"{topic}: A Practical Comparison Guide",
            f"Best {primary_keyword} Picks and What to Check",
        ]
    return [
        f"How to {topic}",
        f"{topic}: A Practical SEO Guide",
        f"What to Know Before You Buy {primary_keyword}",
    ]


def _generate_meta_title_options(title_options: list[str], primary_keyword: str) -> list[str]:
    base_titles = [
        f"{title_options[0]} | Shopify Guide",
        f"{primary_keyword.title()} Buying Guide | Shopify",
        f"{primary_keyword.title()}: Human SEO Brief | Shopify",
    ]
    return [title for title in base_titles if title]


def _generate_meta_description_options(
    source_type: SourceType,
    topic: str,
    primary_keyword: str,
    search_intent: str,
) -> list[str]:
    if source_type == SourceType.product:
        return [
            f"Learn whether {primary_keyword} fits your use case, what to check first, and how to avoid a bad buy.",
            f"A practical guide to {topic} with buyer trade-offs, confirmed facts, and next-step guidance.",
        ]
    if source_type == SourceType.collection:
        return [
            f"Compare the best {topic} options, check the trade-offs, and choose the right one faster.",
            f"Use this brief to write a clear {topic} guide that matches commercial search intent.",
        ]
    return [
        f"Read a human-style {topic} guide built for {search_intent.lower()} intent, strong structure, and SEO readiness.",
        f"Use this brief to turn {primary_keyword} into a useful, searchable Shopify article.",
    ]


def _section_heading(section_key: str, topic: str, primary_keyword: str) -> str:
    headings = {
        "answer_first_intro": "Quick answer",
        "verified_facts": f"What is confirmed about {topic}",
        "decision_support": f"How to choose {primary_keyword}",
        "faq_section": "FAQ",
        "publish_check": "Before you publish",
        "post_publish_review": "After launch",
    }
    return headings.get(section_key, section_key.replace("_", " ").title())


def _generate_faq_questions(source_type: SourceType, topic: str, primary_keyword: str) -> list[str]:
    if source_type == SourceType.product:
        return [
            f"Is {primary_keyword} worth it for my use case?",
            f"What should I check before buying {topic}?",
            f"When should I skip {primary_keyword}?",
        ]
    if source_type == SourceType.collection:
        return [
            f"Which {topic} option fits my budget?",
            f"How do I compare the items in this collection?",
            f"What should I verify before choosing one?",
        ]
    return [
        f"What is the fastest way to choose {topic}?",
        f"What should I verify before I publish this article?",
        f"When should I refresh the article after launch?",
    ]


def _generate_internal_link_plan(available_internal_links: int) -> list[str]:
    if available_internal_links <= 0:
        return ["Plan one product link, one collection link, and one related article link once the catalog is synced."]
    return [
        "Link to one closely related product page.",
        "Link to one related collection or category page.",
        "Link to one comparison or guide article.",
    ][: max(1, min(3, available_internal_links))]


def _generate_external_reference_plan(available_external_references: int, search_console_connected: bool) -> list[str]:
    plan = [
        "Cite approved external sources for any factual or trend-based claim.",
        "Tie every citation to one specific sentence or decision point.",
    ]
    if search_console_connected:
        plan.append("Use Search Console evidence to validate after publish instead of guessing ranking outcomes.")
    if available_external_references <= 0:
        plan.append("Collect at least one approved external source before finalizing the draft.")
    return plan
