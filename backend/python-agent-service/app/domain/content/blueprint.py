from __future__ import annotations

from app.schemas.agents import AgentRole
from app.schemas.content import ContentArticleBlueprint, ContentArticleBlueprintSection


BLUEPRINT_SOURCES = [
    "Google Search Central: Creating helpful, reliable, people-first content",
    "Google Search Central: SEO starter guide",
    "Google Search Console: Performance report metrics for queries, CTR, and average position",
    "ericosiu/ai-marketing-skills: content-ops humanizer and content-quality gate",
    "TheCraigHewitt/seomachine: style guide and write -> optimize -> performance-review workflow",
]


def build_content_article_blueprint() -> ContentArticleBlueprint:
    return ContentArticleBlueprint(
        article_type="Shopify SEO blog article",
        summary=(
            "Use this blueprint to generate a buyer-useful blog post that reads like a human draft, "
            "passes the quality gate, and stays grounded in evidence."
        ),
        audience="Shopify shoppers, operators, and buyers comparing products or decisions.",
        target_length="1500-2200 words",
        outline=[
            ContentArticleBlueprintSection(
                key="answer_first_intro",
                title="Answer-first intro",
                agent_role=AgentRole.writer,
                purpose="Open with the direct answer, why it matters, and what the reader will get.",
                target_words=160,
                must_have=[
                    "Primary keyword in the first 100 words",
                    "One direct answer to the query",
                    "One concrete buyer promise"
                ],
                avoid=[
                    "Generic lead-in",
                    "Future outlook section",
                    "Empty motivational language"
                ],
                quality_gate="The reader should understand the answer in a few seconds."
            ),
            ContentArticleBlueprintSection(
                key="verified_facts",
                title="Verified facts and context",
                agent_role=AgentRole.researcher,
                purpose="Separate confirmed facts from unknowns and anchor the article in real store evidence.",
                target_words=320,
                must_have=[
                    "Confirmed product or store facts",
                    "Specific numbers or details where available",
                    "Clear labels for unknown or unconfirmed claims"
                ],
                avoid=[
                    "Industry reports",
                    "Sources suggest",
                    "Vague attribution"
                ],
                quality_gate="Claims must be supportable by Shopify data or approved references."
            ),
            ContentArticleBlueprintSection(
                key="decision_support",
                title="Decision support",
                agent_role=AgentRole.writer,
                purpose="Help the reader choose, compare, or skip with practical trade-offs.",
                target_words=380,
                must_have=[
                    "Choose this if / skip this if guidance",
                    "A comparison table or decision matrix",
                    "One concrete recommendation for each major scenario"
                ],
                avoid=[
                    "Pure promotion",
                    "No trade-off framing",
                    "Overstated certainty"
                ],
                quality_gate="The article should help someone make a purchase or next-step decision."
            ),
            ContentArticleBlueprintSection(
                key="faq_section",
                title="FAQ",
                agent_role=AgentRole.seo_editor,
                purpose="Answer real buyer questions with short, direct replies and clear headings.",
                target_words=260,
                must_have=[
                    "At least 3 real questions",
                    "Question-style headings",
                    "Direct answers beneath each question"
                ],
                avoid=[
                    "Thin FAQ filler",
                    "Duplicate questions",
                    "Answers that dodge the question"
                ],
                quality_gate="FAQ depth should reflect real search intent, not padding."
            ),
            ContentArticleBlueprintSection(
                key="publish_check",
                title="Publish check",
                agent_role=AgentRole.publisher_guard,
                purpose="Confirm metadata, links, images, and canonical readiness before the article goes live.",
                target_words=160,
                must_have=[
                    "Meta title and meta description",
                    "Descriptive internal and external links",
                    "Descriptive alt text for images"
                ],
                avoid=[
                    "Click here anchors",
                    "Missing canonical URL",
                    "Unclear publish target"
                ],
                quality_gate="Do not treat the article as index-ready until the public URL exists."
            ),
            ContentArticleBlueprintSection(
                key="post_publish_review",
                title="Post-publish review",
                agent_role=AgentRole.growth_analyst,
                purpose="Use Search Console to decide refresh, expansion, or title/meta changes after publish.",
                target_words=120,
                must_have=[
                    "Impressions",
                    "CTR",
                    "Average position",
                    "Query gaps"
                ],
                avoid=[
                    "Ranking guarantees",
                    "Opinion without evidence",
                    "One-off vanity fixes"
                ],
                quality_gate="Only real Search Console data should drive rank-ready decisions."
            ),
        ],
        seo_rules=[
            "Title and meta description should include the primary keyword in the title, first 100 words, and one H2 where it fits naturally.",
            "Use 3-5 substantive H2 sections with descriptive headings.",
            "Keep meta titles around 50-60 characters and meta descriptions around 150-160 characters.",
            "Use descriptive anchor text for internal and external links.",
            "Add descriptive alt text to images and keep it specific.",
            "Use canonical URLs after publish, then validate Search Console performance before ranking claims."
        ],
        humanizer_rules=[
            "Start with the answer, not with a long preamble.",
            "Prefer short, concrete verbs and specific examples over abstract phrasing.",
            "Keep sentence rhythm mixed so the copy feels written, not auto-generated.",
            "Avoid banned AI vocabulary such as leverage, nuanced, tapestry, and robust.",
            "Avoid formulaic sections like 'future outlook' or generic 'despite the challenges' endings.",
            "Avoid click here, learn more, and other weak anchor text.",
            "Avoid overusing em dashes, boldface, and rule-of-three patterns.",
            "Use direct opinions when the data supports them."
        ],
        publish_rules=[
            "Publish only when the quality gate, helpful-content review, and humanizer review all pass.",
            "Do not mark the article as rank-ready without Search Console evidence.",
            "Separate publish-ready from index-ready and rank-ready in the UI.",
            "Treat post-publish performance as a new optimization loop, not a final score."
        ],
        anti_patterns=[
            "Vague attributions",
            "Generic positive conclusions",
            "Future outlook sections",
            "Em dash overuse",
            "Click here anchors",
            "AI vocabulary clustering",
            "Undue notability claims",
            "Formulaic challenge-and-future endings"
        ],
        doctrine_sources=BLUEPRINT_SOURCES,
    )
