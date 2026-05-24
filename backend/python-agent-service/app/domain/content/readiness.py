from __future__ import annotations

from app.schemas.agents import AgentRole
from app.schemas.content import ContentReadinessDoctrine, ContentReadinessStage
from app.schemas.seo import PriorityLevel


READINESS_SOURCES = [
    "Google Search Central: Creating helpful, reliable, people-first content",
    "Google Search Central: SEO starter guide",
    "Google Search Console: Performance report metrics for queries, CTR, and average position",
    "ericosiu/ai-marketing-skills: seo-ops, content-ops humanizer, and content quality rubrics",
    "TheCraigHewitt/seomachine: research -> write -> optimize -> performance-review workflow",
]


def build_content_readiness_doctrine() -> ContentReadinessDoctrine:
    stages = [
        ContentReadinessStage(
            key="publish_ready",
            label="Publish-ready",
            badge="发前检查",
            tone=PriorityLevel.high,
            summary="内容质量、结构、证据、人味和 SEO 基础都过线后，才进入 Shopify 发布。",
            required_checks=[
                "Quality gate passed and SEO score reaches the configured publish threshold.",
                "Title, summary, meta description, headings, FAQ, image alt text, and links are specific.",
                "Helpful Content and Humanizer reviews pass without template-heavy or unsupported claims.",
                "Internal links, approved external references, and decision support help the shopper choose.",
            ],
            agent_roles=[AgentRole.writer, AgentRole.seo_editor, AgentRole.researcher],
            evidence_required=[
                "article draft HTML",
                "quality gate scores",
                "humanizer signals",
                "helpful content checks",
                "internal and external link evidence",
            ],
            next_action="Run repair tasks for any failed publish gate before sending the article to Shopify.",
        ),
        ContentReadinessStage(
            key="index_ready",
            label="Index-ready",
            badge="可收录",
            tone=PriorityLevel.medium,
            summary="文章已经发布，并且有可访问 canonical URL，Google 才有可抓取页面。",
            required_checks=[
                "Publish-ready checks are already true.",
                "Shopify publish action completed successfully.",
                "Canonical URL exists and points to the preferred public article URL.",
                "The page is ready for Search Console inspection and sitemap discovery.",
            ],
            agent_roles=[AgentRole.publisher_guard, AgentRole.growth_analyst],
            evidence_required=[
                "published article status",
                "canonical URL",
                "storefront reachable URL",
                "Search Console property connection",
            ],
            next_action="Publish or repair the canonical URL, then sync Search Console for real visibility data.",
        ),
        ContentReadinessStage(
            key="rank_ready",
            label="Rank-ready",
            badge="需验证",
            tone=PriorityLevel.low,
            summary="排名优化必须用 Search Console 的曝光、CTR、平均排名和 query gap 来判断，不能只看生成结果。",
            required_checks=[
                "Index-ready checks are true and the article has time to gather search data.",
                "Search Console impressions, clicks, CTR, and average position are available.",
                "Query gaps, low-CTR queries, and striking-distance keywords are reviewed.",
                "Refresh tasks are prioritized by impact, confidence, and observed search intent.",
            ],
            agent_roles=[AgentRole.growth_analyst, AgentRole.seo_editor, AgentRole.keyword_planner],
            evidence_required=[
                "Search Console impressions",
                "Search Console clicks and CTR",
                "average position",
                "query gap and striking-distance keyword report",
            ],
            next_action="Use Search Console evidence to choose refresh, title/meta, internal-link, or expansion tasks.",
        ),
    ]

    return ContentReadinessDoctrine(
        stages=stages,
        default_sequence=[stage.key for stage in stages],
        no_guarantee_notice=(
            "系统只能判断发布、抓取和复盘准备度；Google 收录和排名提升不能保证，"
            "必须以上线后的 Search Console 证据继续优化。"
        ),
        doctrine_sources=READINESS_SOURCES,
    )
