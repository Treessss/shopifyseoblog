from app.core.config import Settings
from app.schemas.agents import AgentRole
from app.schemas.content import ArticleRepairPlanInput
from app.services.repair_planner import get_article_repair_plan


def test_repair_plan_turns_thin_article_into_agent_tasks() -> None:
    plan = get_article_repair_plan(
        ArticleRepairPlanInput(
            article_id="article_1",
            status="quality_failed",
            title="Ultimate Guide",
            body_html="<p>In conclusion, this is a comprehensive guide.</p>",
            summary="Short summary.",
            primary_keyword="phone case",
            seo_score=58,
            ai_search_score=50,
            editorial_score=42,
            expert_panel_score=40,
            quality_passed=False,
            repair_reason="Quality gate failed after generation.",
        ),
        Settings(),
    )

    task_roles = {task.agent_role for task in plan.tasks}
    task_ids = {task.id for task in plan.tasks}

    assert plan.mode == "pre_publish_repair"
    assert plan.quality_gate.publish_ready is False
    assert AgentRole.writer in task_roles
    assert AgentRole.seo_editor in task_roles
    assert "writer-depth" in task_ids
    assert "seo-editor-humanizer" in task_ids
    assert plan.blockers[0] == "Quality gate failed after generation."
    assert plan.next_step == plan.tasks[0].instruction


def test_repair_plan_publish_ready_article_moves_to_publisher_guard() -> None:
    plan = get_article_repair_plan(
        ArticleRepairPlanInput(
            article_id="article_2",
            status="ready_to_publish",
            title="Useful Shopify SEO Article",
            summary="Useful Shopify SEO Article helps shoppers compare daily fit, facts, links, and FAQ checks before publishing.",
            primary_keyword="Shopify SEO Article",
            seo_title="Useful Shopify SEO Article",
            seo_description="Useful Shopify SEO Article helps shoppers compare daily fit, facts, links, and FAQ checks before publishing.",
            body_html=(
                "<section><h2>Quick answer</h2><p>Choose this phone case if you want a daily fit check before buying.</p></section>"
                "<section><h2>Shopify SEO Article verified facts</h2><p>Confirmed product facts and not confirmed specs are separated.</p></section>"
                "<section><h2>Decision support</h2><p>Choose this if you need grip; skip it if you need waterproof protection.</p></section>"
                "<section><h2>FAQ</h2><h3>Does it fit daily use?</h3><p>Yes, when the synced product facts match the reader's everyday case, fit, and care checks.</p>"
                "<h3>What should shoppers verify?</h3><p>They should verify confirmed product facts, not confirmed specs, internal links, and source-backed claims before publishing.</p>"
                "<h3>When should readers skip it?</h3><p>They should skip when they need waterproof protection or facts that the Shopify data has not confirmed.</p></section>"
                '<section><h2>Next step</h2><p><a href="/collections/cases">Shopify SEO Article collection</a> and <a href="https://trends.google.com/trends/explore?q=shopify%20seo%20article" rel="nofollow noopener noreferrer">Google Trends demand check</a>.</p></section>'
                + "<p>Specific buyer guidance with exact product checks. " * 80
                + "</p>"
            ),
            seo_score=88,
            ai_search_score=86,
            editorial_score=78,
            expert_panel_score=92,
            has_internal_links=True,
            has_external_references=True,
            has_decision_support=True,
            has_faq=True,
            has_images=True,
            image_alt_texts=["Shopify SEO Article daily product comparison scene"],
            quality_passed=True,
            has_canonical_url=False,
        ),
        Settings(),
    )

    assert plan.mode == "publish_and_index"
    assert plan.quality_gate.publish_ready is True
    assert plan.quality_gate.index_ready is False
    assert [task.agent_role for task in plan.tasks] == [AgentRole.publisher_guard, AgentRole.growth_analyst]
    assert plan.tasks[0].source_check_key == "canonical"
    assert plan.tasks[1].depends_on == ["publisher-guard"]


def test_repair_plan_published_article_creates_growth_review_task() -> None:
    plan = get_article_repair_plan(
        ArticleRepairPlanInput(
            article_id="article_3",
            status="published",
            canonical_url="https://example.com/blog/useful-shopify-seo-article",
            title="Useful Shopify SEO Article",
            summary="Useful Shopify SEO Article helps shoppers compare daily fit, facts, links, and FAQ checks before publishing.",
            primary_keyword="Shopify SEO Article",
            seo_title="Useful Shopify SEO Article",
            seo_description="Useful Shopify SEO Article helps shoppers compare daily fit, facts, links, and FAQ checks before publishing.",
            body_html=(
                "<section><h2>Quick answer</h2><p>Choose this phone case if you want a daily fit check before buying.</p></section>"
                "<section><h2>Shopify SEO Article verified facts</h2><p>Confirmed product facts and not confirmed specs are separated.</p></section>"
                "<section><h2>Decision support</h2><p>Choose this if you need grip; skip it if you need waterproof protection.</p></section>"
                "<section><h2>FAQ</h2><h3>Does it fit daily use?</h3><p>Yes, when the synced product facts match the reader's everyday case, fit, and care checks.</p>"
                "<h3>What should shoppers verify?</h3><p>They should verify confirmed product facts, not confirmed specs, internal links, and source-backed claims before publishing.</p>"
                "<h3>When should readers skip it?</h3><p>They should skip when they need waterproof protection or facts that the Shopify data has not confirmed.</p></section>"
                '<section><h2>Next step</h2><p><a href="/collections/cases">Shopify SEO Article collection</a> and <a href="https://trends.google.com/trends/explore?q=shopify%20seo%20article" rel="nofollow noopener noreferrer">Google Trends demand check</a>.</p></section>'
                + "<p>Specific buyer guidance with exact product checks. " * 80
                + "</p>"
            ),
            seo_score=88,
            ai_search_score=86,
            editorial_score=78,
            expert_panel_score=92,
            has_internal_links=True,
            has_external_references=True,
            has_decision_support=True,
            has_faq=True,
            has_images=True,
            image_alt_texts=["Shopify SEO Article daily product comparison scene"],
            quality_passed=True,
            has_canonical_url=True,
        ),
        Settings(),
    )

    assert plan.mode == "post_publish_refresh"
    assert plan.quality_gate.index_ready is True
    assert [task.agent_role for task in plan.tasks] == [AgentRole.growth_analyst]
    assert plan.tasks[0].source_check_key == "search_console"
