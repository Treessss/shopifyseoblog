from app.core.config import Settings
from app.domain.quality.doctrine import assess_helpful_content
from app.domain.quality.humanizer import assess_humanizer
from app.schemas.content import ArticleQualityGate, ArticleQualityInput, QualityCheck


def evaluate_article_quality(article: ArticleQualityInput, settings: Settings) -> ArticleQualityGate:
    seo_score = article.seo_score or 0
    ai_search_score = article.ai_search_score or 0
    editorial_score = article.editorial_score or 0
    expert_panel_score = article.expert_panel_score or 0
    body_text = _strip_html(article.body_html)
    body_text_length = len(body_text)
    structure = _assess_structure(article, body_text)
    humanizer = assess_humanizer(article.body_html, article.brand_voice_banned_words)
    helpful_content = assess_helpful_content(
        article.body_html,
        has_internal_links=article.has_internal_links,
        has_external_references=article.has_external_references,
        has_faq=article.has_faq,
        has_decision_support=article.has_decision_support,
    )

    checks = [
        QualityCheck(
            key="quality_gate",
            label="Quality gate",
            passed=article.quality_passed and seo_score >= settings.min_publish_seo_score,
            detail=f"SEO score {seo_score}; publish threshold {settings.min_publish_seo_score}.",
        ),
        QualityCheck(
            key="content_depth",
            label="Useful depth",
            passed=body_text_length >= 1200,
            detail=f"Body text length is {body_text_length} characters.",
        ),
        QualityCheck(
            key="title_intent",
            label="Title matches intent",
            passed=structure["title_intent"],
            detail=_title_intent_detail(article),
        ),
        QualityCheck(
            key="summary_meta",
            label="Summary and meta description",
            passed=structure["summary_meta"],
            detail=_summary_meta_detail(article),
        ),
        QualityCheck(
            key="heading_structure",
            label="Heading structure",
            passed=structure["heading_structure"],
            detail=structure["heading_detail"],
        ),
        QualityCheck(
            key="editorial_quality",
            label="Human editorial quality",
            passed=editorial_score >= settings.min_editorial_score,
            detail=f"Editorial score {editorial_score}; target {settings.min_editorial_score}.",
        ),
        QualityCheck(
            key="humanizer",
            label="Human-like voice",
            passed=humanizer.score >= settings.min_editorial_score,
            detail=f"Humanizer score {humanizer.score}; editorial advisory target {settings.min_editorial_score}.",
        ),
        QualityCheck(
            key="helpful_content",
            label="Helpful content",
            passed=helpful_content.score >= settings.min_editorial_score,
            detail=f"Helpful content score {helpful_content.score}; based on Google people-first content, ai-marketing-skills, and seomachine workflow signals.",
        ),
        QualityCheck(
            key="expert_panel",
            label="Expert panel",
            passed=expert_panel_score >= settings.expert_panel_pass_score,
            detail=f"Expert panel score {expert_panel_score}; target {settings.expert_panel_pass_score}.",
        ),
        QualityCheck(
            key="internal_links",
            label="Internal links",
            passed=article.has_internal_links and structure["descriptive_internal_anchors"],
            detail=structure["internal_anchor_detail"],
        ),
        QualityCheck(
            key="external_references",
            label="External references",
            passed=article.has_external_references and structure["descriptive_external_anchors"],
            detail=structure["external_anchor_detail"],
        ),
        QualityCheck(
            key="search_review",
            label="AI search review",
            passed=ai_search_score >= settings.min_publish_seo_score,
            detail=f"AI search score {ai_search_score}; target {settings.min_publish_seo_score}.",
        ),
        QualityCheck(
            key="decision_support",
            label="Decision support",
            passed=article.has_decision_support,
            detail="Article should help shoppers choose, skip, compare, or continue.",
        ),
        QualityCheck(
            key="faq",
            label="Search-intent FAQ",
            passed=article.has_faq and structure["faq_depth"],
            detail=structure["faq_detail"],
        ),
        QualityCheck(
            key="image_alt",
            label="Image alt text",
            passed=structure["image_alt"],
            detail=structure["image_alt_detail"],
        ),
        QualityCheck(
            key="canonical",
            label="Canonical URL",
            passed=article.has_canonical_url,
            detail="A published canonical URL is required before Search Console performance review.",
        ),
    ]

    passed_count = sum(1 for check in checks if check.passed)
    score = round(passed_count / len(checks) * 100)
    required_publish_checks = {
        "quality_gate",
        "content_depth",
        "title_intent",
        "summary_meta",
        "heading_structure",
        "editorial_quality",
        "expert_panel",
        "helpful_content",
        "internal_links",
        "external_references",
        "search_review",
        "decision_support",
        "faq",
        "image_alt",
    }
    publish_ready = all(check.passed for check in checks if check.key in required_publish_checks)
    index_ready = publish_ready and next(check for check in checks if check.key == "canonical").passed

    return ArticleQualityGate(
        publish_ready=publish_ready,
        index_ready=index_ready,
        score=score,
        checks=checks,
        next_step=_next_step(checks),
        humanizer_score=humanizer.score,
        humanizer_signals=humanizer.signals,
        humanizer_recommendations=humanizer.recommendations,
        helpful_content_score=helpful_content.score,
        helpful_content_signals=helpful_content.signals,
        helpful_content_recommendations=helpful_content.recommendations,
        doctrine_sources=helpful_content.sources,
    )


def _next_step(checks: list[QualityCheck]) -> str:
    required_publish_checks = {
        "quality_gate",
        "content_depth",
        "title_intent",
        "summary_meta",
        "heading_structure",
        "editorial_quality",
        "expert_panel",
        "helpful_content",
        "internal_links",
        "external_references",
        "search_review",
        "decision_support",
        "faq",
        "image_alt",
    }
    first_failed = next((check for check in checks if check.key in required_publish_checks and not check.passed), None)
    if not first_failed:
        humanizer_failed = next((check for check in checks if check.key == "humanizer" and not check.passed), None)
        if humanizer_failed:
            return "Publish is ready; review the Humanizer suggestions before launch."
        canonical_failed = next((check for check in checks if check.key == "canonical" and not check.passed), None)
        if canonical_failed:
            return "Publish the article to Shopify, then sync Search Console."
        return "Monitor Search Console impressions, average position, CTR, and query gaps."
    return "Run AI repair before publishing."


def _strip_html(value: str) -> str:
    output: list[str] = []
    in_tag = False
    for char in value:
        if char == "<":
            in_tag = True
            output.append(" ")
        elif char == ">":
            in_tag = False
        elif not in_tag:
                output.append(char)
    return " ".join("".join(output).split())


def _assess_structure(article: ArticleQualityInput, body_text: str) -> dict[str, bool | str]:
    headings = _extract_headings(article.body_html)
    h2s = [text for level, text in headings if level == 2]
    faq_questions = _faq_questions(article.body_html, body_text)
    anchors = _extract_anchors(article.body_html)
    internal_anchors = [anchor for anchor in anchors if not _is_external_url(anchor["href"])]
    external_anchors = [anchor for anchor in anchors if _is_external_url(anchor["href"])]
    image_alts = [alt.strip() for alt in article.image_alt_texts if alt and alt.strip()]
    keyword = (article.primary_keyword or "").strip()
    title_text = article.seo_title or article.title
    summary_text = article.seo_description or article.summary or ""
    summary_min, summary_max = _summary_length_bounds(summary_text)
    title_keyword_ok = not keyword or _keyword_coverage(title_text, keyword) >= 0.5
    summary_keyword_ok = not keyword or _keyword_coverage(summary_text, keyword) >= 0.4
    h2_keyword_hits = sum(1 for heading in h2s if not keyword or _keyword_coverage(heading, keyword) >= 0.35)
    descriptive_internal = _descriptive_anchor_count(internal_anchors)
    descriptive_external = _descriptive_anchor_count(external_anchors)
    generic_internal = _generic_anchor_labels(internal_anchors)
    generic_external = _generic_anchor_labels(external_anchors)
    return {
        "title_intent": 8 <= len(article.title.strip()) <= 72 and title_keyword_ok and not _looks_like_clickbait(article.title),
        "summary_meta": summary_min <= len(summary_text) <= summary_max and summary_keyword_ok,
        "heading_structure": len(h2s) >= 3 and h2_keyword_hits >= 1 and not _has_skipped_heading_levels(headings),
        "heading_detail": f"{len(h2s)} H2 sections; {h2_keyword_hits} include the primary intent; skipped levels: {_has_skipped_heading_levels(headings)}.",
        "faq_depth": len(faq_questions) >= 3 and _average_answer_length_near_faq(article.body_html) >= 45,
        "faq_detail": f"{len(faq_questions)} FAQ-style questions found; average answer length near FAQ is {_average_answer_length_near_faq(article.body_html)} characters.",
        "image_alt": (not article.has_images and not image_alts) or _image_alts_are_descriptive(image_alts, keyword),
        "image_alt_detail": _image_alt_detail(article, image_alts),
        "descriptive_internal_anchors": not article.has_internal_links or descriptive_internal > 0 and not generic_internal,
        "internal_anchor_detail": _anchor_detail("internal", internal_anchors, descriptive_internal, generic_internal),
        "descriptive_external_anchors": not article.has_external_references or descriptive_external > 0 and not generic_external,
        "external_anchor_detail": _anchor_detail("external", external_anchors, descriptive_external, generic_external),
    }


def _title_intent_detail(article: ArticleQualityInput) -> str:
    keyword = article.primary_keyword or "not supplied"
    return f"Title length {len(article.title.strip())}; primary keyword intent: {keyword}; avoid clickbait or generic guide titles."


def _summary_meta_detail(article: ArticleQualityInput) -> str:
    summary = article.seo_description or article.summary or ""
    summary_min, summary_max = _summary_length_bounds(summary)
    return f"Summary/meta length {len(summary)}; target {summary_min}-{summary_max} characters with a concrete buyer promise."


def _extract_headings(html: str) -> list[tuple[int, str]]:
    import re

    headings: list[tuple[int, str]] = []
    for match in re.finditer(r"<h([1-6])\b[^>]*>(.*?)</h\1>", html, re.I | re.S):
        headings.append((int(match.group(1)), _strip_html(match.group(2))))
    return headings


def _has_skipped_heading_levels(headings: list[tuple[int, str]]) -> bool:
    previous = 1
    for level, _ in headings:
        if level > previous + 1:
            return True
        previous = level
    return False


def _faq_questions(html: str, text: str) -> list[str]:
    import re

    question_headings = [_strip_html(match.group(1)) for match in re.finditer(r"<h[23]\b[^>]*>(.*?)</h[23]>", html, re.I | re.S)]
    questions = [item for item in question_headings if "?" in item or "？" in item or item.lower().startswith(("what ", "how ", "when ", "why ", "is ", "can ", "should "))]
    if not questions and ("faq" in text.lower() or "常见问题" in text):
        questions = re.findall(r"[^.?!。？！]{6,80}[?？]", text)
    return questions


def _average_answer_length_near_faq(html: str) -> int:
    import re

    answers = [_strip_html(match.group(1)) for match in re.finditer(r"<h3\b[^>]*>.*?[?？].*?</h3>\s*<p\b[^>]*>(.*?)</p>", html, re.I | re.S)]
    if not answers:
        return 0
    return round(sum(len(answer) for answer in answers) / len(answers))


def _extract_anchors(html: str) -> list[dict[str, str]]:
    import re

    anchors: list[dict[str, str]] = []
    for match in re.finditer(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", html, re.I | re.S):
        anchors.append({"href": match.group(1), "label": _strip_html(match.group(2))})
    return anchors


def _is_external_url(value: str) -> bool:
    if not (value.startswith("http://") or value.startswith("https://")):
        return False
    try:
        from urllib.parse import urlparse

        parsed = urlparse(value)
        host = parsed.netloc.lower()
        path = parsed.path.lower()
        if "myshopify.com" in host:
            return False
        if _looks_like_storefront_host(host) and any(segment in path for segment in ("/products/", "/collections/", "/blogs/", "/pages/")):
            return False
        return True
    except ValueError:
        return False


def _looks_like_storefront_host(host: str) -> bool:
    storefront_markers = ("shop", "store", "caseease", "era-noir", "eranoir")
    return any(marker in host for marker in storefront_markers)


def _descriptive_anchor_count(anchors: list[dict[str, str]]) -> int:
    return sum(1 for anchor in anchors if _is_descriptive_anchor(anchor["label"]))


def _generic_anchor_labels(anchors: list[dict[str, str]]) -> list[str]:
    return [anchor["label"] for anchor in anchors if not _is_descriptive_anchor(anchor["label"])]


def _is_descriptive_anchor(label: str) -> bool:
    normalized = label.strip().lower()
    if not normalized:
        return False
    if normalized in {"click here", "here", "read more", "learn more", "link", "source", "this article", "打开链接", "点击这里", "了解更多", "阅读更多", "来源"}:
        return False
    return len(normalized) >= 6 or len(label) >= 4


def _anchor_detail(kind: str, anchors: list[dict[str, str]], descriptive: int, generic: list[str]) -> str:
    if not anchors:
        return f"No {kind} anchor tags found."
    if generic:
        return f"{descriptive}/{len(anchors)} {kind} anchors are descriptive; generic labels: {', '.join(generic[:3])}."
    return f"{descriptive}/{len(anchors)} {kind} anchors are descriptive and useful."


def _image_alts_are_descriptive(alts: list[str], keyword: str) -> bool:
    if not alts:
        return False
    return all(_is_descriptive_alt(alt, keyword) for alt in alts)


def _is_descriptive_alt(alt: str, keyword: str) -> bool:
    normalized = alt.strip().lower()
    generic = {"image", "photo", "picture", "article image", "blog image", "product image", "图片", "文章图片", "商品图片"}
    if normalized in generic:
        return False
    if len(alt) < 8:
        return False
    return not keyword or _keyword_coverage(alt, keyword) >= 0.25 or len(alt) >= 16


def _image_alt_detail(article: ArticleQualityInput, alts: list[str]) -> str:
    if not article.has_images and not alts:
        return "No article images are attached, so alt text is not required yet."
    if not alts:
        return "Article has images but no alt text."
    return f"{len(alts)} image alt text value(s); each should describe the product/use case, not just say image/photo."


def _keyword_coverage(text: str, keyword: str) -> float:
    text_tokens = set(_keyword_tokens(text))
    keyword_tokens = _keyword_tokens(keyword)
    if not keyword_tokens:
        return 1.0
    hits = sum(1 for token in keyword_tokens if token in text_tokens or token in text.lower())
    return hits / len(keyword_tokens)


def _keyword_tokens(value: str) -> list[str]:
    import re

    tokens = re.findall(r"[\w\u3400-\u9fff]+", value.lower())
    return [token for token in tokens if len(token) >= 2 and token not in {"the", "and", "for", "with", "from", "guide", "article", "选购", "指南"}]


def _looks_like_clickbait(title: str) -> bool:
    lowered = title.lower()
    return any(marker in lowered for marker in ("you won't believe", "ultimate guide", "everything you need", "must-have", "震惊", "必看", "终极指南"))


def _summary_length_bounds(value: str) -> tuple[int, int]:
    import re

    cjk_chars = len(re.findall(r"[\u3400-\u9fff]", value))
    return (40, 160) if cjk_chars >= 10 else (80, 180)
