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
            role=AgentRole.writer,
            name="Writer Agent",
            responsibility="Draft human-like ecommerce SEO articles grounded in store data.",
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
