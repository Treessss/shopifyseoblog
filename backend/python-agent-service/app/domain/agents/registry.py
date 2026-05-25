from app.schemas.agents import AgentDescriptor, AgentRole, AgentStatus


def default_agent_registry() -> list[AgentDescriptor]:
    return [
        AgentDescriptor(
            role=AgentRole.researcher,
            name="Research Agent",
            responsibility="Collect Shopify context, trend signals, internal links, and external references.",
        ),
        AgentDescriptor(
            role=AgentRole.keyword_planner,
            name="Keyword Planner Agent",
            responsibility="Build primary, secondary, and long-tail keyword plans from evidence.",
        ),
        AgentDescriptor(
            role=AgentRole.topic_strategist,
            name="SEO Strategist Agent",
            responsibility="Choose the angle, funnel stage, and differentiation strategy before drafting.",
        ),
        AgentDescriptor(
            role=AgentRole.writer,
            name="Writer Agent",
            responsibility="Maintain legacy article-writing compatibility while specialized editors take over new flows.",
        ),
        AgentDescriptor(
            role=AgentRole.shopping_guide_editor,
            name="Shopping Guide Editor Agent",
            responsibility="Draft buyer-useful ecommerce articles with concrete choose/skip guidance.",
        ),
        AgentDescriptor(
            role=AgentRole.fact_checker,
            name="Fact Checker Agent",
            responsibility="Verify product claims, external references, links, and unsupported assertions.",
        ),
        AgentDescriptor(
            role=AgentRole.image_director,
            name="Image Director Agent",
            responsibility="Plan cover images, alt text, and product-grounded visual direction.",
        ),
        AgentDescriptor(
            role=AgentRole.seo_editor,
            name="SEO Gate Agent",
            responsibility="Score helpfulness, search intent, structure, links, citations, and editorial rhythm.",
        ),
        AgentDescriptor(
            role=AgentRole.publisher_guard,
            name="Publisher Guard Agent",
            responsibility="Block unsafe publishing until quality, canonical, and Shopify requirements are met.",
        ),
        AgentDescriptor(
            role=AgentRole.growth_analyst,
            name="Growth Analyst Agent",
            responsibility="Turn Search Console signals into repair, refresh, and new-campaign priorities.",
            status=AgentStatus.idle,
        ),
    ]
