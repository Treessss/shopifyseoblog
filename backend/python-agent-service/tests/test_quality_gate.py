from app.core.config import Settings
from app.schemas.content import ArticleQualityInput
from app.services.quality_gate import evaluate_article_quality


def test_quality_gate_blocks_unpublished_article() -> None:
    result = evaluate_article_quality(
        ArticleQualityInput(
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

    assert result.publish_ready is True
    assert result.index_ready is False
    assert result.next_step == "Publish the article to Shopify, then sync Search Console."
    assert any(check.key == "humanizer" and check.passed for check in result.checks)
    assert result.helpful_content_score >= 72
    assert result.doctrine_sources


def test_quality_gate_requires_repair_when_scores_are_low() -> None:
    result = evaluate_article_quality(
        ArticleQualityInput(
            title="Thin draft",
            body_html="<p>Short draft</p>",
            seo_score=60,
            ai_search_score=55,
            editorial_score=40,
            expert_panel_score=52,
            quality_passed=False,
        ),
        Settings(),
    )

    assert result.publish_ready is False
    assert result.index_ready is False
    assert result.next_step == "Run AI repair before publishing."


def test_quality_gate_penalizes_template_like_and_brand_unsafe_language() -> None:
    result = evaluate_article_quality(
        ArticleQualityInput(
            title="Thin draft",
            body_html="<p>In conclusion, this is a robust, seamless, cutting-edge guide.</p>",
            seo_score=88,
            ai_search_score=86,
            editorial_score=78,
            expert_panel_score=92,
            quality_passed=True,
            has_internal_links=True,
            has_external_references=True,
            has_decision_support=True,
            has_faq=True,
            has_canonical_url=True,
            brand_voice_banned_words=["robust"],
        ),
        Settings(),
    )

    assert result.humanizer_score < 90
    assert result.humanizer_signals
    assert any("brand banned words" in signal for signal in result.humanizer_signals)
    assert result.publish_ready is False
    assert result.next_step == "Run AI repair before publishing."


def test_quality_gate_requires_google_helpful_content_signals() -> None:
    result = evaluate_article_quality(
        ArticleQualityInput(
            title="Generic SEO article",
            body_html="<h2>Future Outlook</h2><p>This comprehensive guide stands as a testament to innovation and synergy.</p>",
            seo_score=90,
            ai_search_score=90,
            editorial_score=80,
            expert_panel_score=94,
            quality_passed=True,
            has_internal_links=True,
            has_external_references=True,
            has_decision_support=False,
            has_faq=False,
            has_canonical_url=True,
        ),
        Settings(),
    )

    assert result.publish_ready is False
    assert result.helpful_content_score < 72
    assert any("missing answer-first" in signal for signal in result.helpful_content_signals)
    assert any("ai-marketing-skills" in source for source in result.doctrine_sources)


def test_quality_gate_requires_canonical_before_index_ready() -> None:
    result = evaluate_article_quality(
        ArticleQualityInput(
            title="Publishable draft",
            summary="Publishable draft helps shoppers compare daily protection, confirmed facts, links, and FAQ checks before publishing.",
            primary_keyword="Publishable draft",
            seo_title="Publishable draft",
            seo_description="Publishable draft helps shoppers compare daily protection, confirmed facts, links, and FAQ checks before publishing.",
            body_html=(
                "<section><h2>Quick answer</h2><p>Choose this if you want a direct fit check before buying.</p></section>"
                "<section><h2>Publishable draft verified facts</h2><p>Confirmed facts and unknown details are separated clearly.</p></section>"
                "<section><h2>Decision support</h2><p>Choose this if you need daily protection; skip it if you need full waterproofing.</p></section>"
                "<section><h2>FAQ</h2><h3>Does it fit daily use?</h3><p>It fits daily use when confirmed facts match the buyer's real routine and product checks.</p>"
                "<h3>What should be checked first?</h3><p>Check confirmed facts, unknown details, internal links, and source-backed context before publishing.</p>"
                "<h3>When should shoppers wait?</h3><p>Wait when waterproofing, material certification, or current pricing has not been confirmed.</p></section>"
                '<section><h2>Next step</h2><p><a href="/collections/cases">Publishable draft collection</a> and <a href="https://trends.google.com/trends/explore?q=publishable%20draft" rel="nofollow noopener noreferrer">Google Trends demand check</a>.</p></section>'
                + "<p>Specific buyer guidance with exact product checks. " * 60
                + "</p>"
            ),
            seo_score=86,
            ai_search_score=84,
            editorial_score=80,
            expert_panel_score=91,
            has_internal_links=True,
            has_external_references=True,
            has_decision_support=True,
            has_faq=True,
            has_images=True,
            image_alt_texts=["Publishable draft product detail comparison image"],
            quality_passed=True,
            has_canonical_url=False,
        ),
        Settings(),
    )

    assert result.publish_ready is True
    assert result.index_ready is False


def test_quality_gate_blocks_thin_seo_structure_even_when_scores_are_high() -> None:
    result = evaluate_article_quality(
        ArticleQualityInput(
            title="Ultimate Guide",
            summary="Short summary.",
            primary_keyword="phone case",
            body_html=(
                "<section><h2>Overview</h2><p>Quick answer: confirmed facts and not confirmed details matter.</p></section>"
                '<section><h2>Links</h2><p><a href="/collections/cases">click here</a></p></section>'
                "<section><h2>FAQ</h2><h3>Does it fit?</h3><p>Maybe.</p></section>"
                + "<p>Specific buyer guidance with exact product checks. " * 80
                + "</p>"
            ),
            seo_score=90,
            ai_search_score=90,
            editorial_score=88,
            expert_panel_score=94,
            has_internal_links=True,
            has_external_references=True,
            has_decision_support=True,
            has_faq=True,
            has_images=True,
            image_alt_texts=["image"],
            quality_passed=True,
            has_canonical_url=True,
        ),
        Settings(),
    )

    assert result.publish_ready is False
    failed_keys = {check.key for check in result.checks if not check.passed}
    assert {"title_intent", "summary_meta", "heading_structure", "faq", "image_alt", "internal_links"} <= failed_keys
