from __future__ import annotations

from dataclasses import dataclass
import re

from app.domain.quality.patterns import AI_FORMULA_PATTERNS


@dataclass(slots=True)
class DoctrineAssessment:
    score: int
    signals: list[str]
    recommendations: list[str]
    sources: list[str]


def assess_helpful_content(
    body_html: str,
    *,
    has_internal_links: bool,
    has_external_references: bool,
    has_faq: bool,
    has_decision_support: bool,
) -> DoctrineAssessment:
    text = _strip_html(body_html)
    normalized = _normalize(text)
    signals: list[str] = []
    recommendations: list[str] = []
    score = 100

    if not _has_answer_first(normalized):
        score -= 12
        signals.append("missing answer-first section")
        recommendations.append("Add a short answer-first block near the top that directly resolves the buyer question.")

    if not _has_verified_fact_language(normalized):
        score -= 12
        signals.append("weak verified-facts language")
        recommendations.append("Separate confirmed Shopify facts from unknown specs instead of implying unverified claims.")

    if not has_decision_support:
        score -= 14
        signals.append("missing decision support")
        recommendations.append("Add choose-this-if / skip-this-if guidance, a comparison table, or pre-purchase checks.")

    if not has_internal_links:
        score -= 10
        signals.append("missing contextual internal links")
        recommendations.append("Add verified product, collection, or article links where they help the shopper continue.")

    if not has_external_references:
        score -= 10
        signals.append("missing approved external references")
        recommendations.append("Cite approved external sources for trend, search demand, or factual background.")

    if not has_faq:
        score -= 8
        signals.append("missing search-intent FAQ")
        recommendations.append("Add FAQ items based on real buyer questions, fit concerns, care, variants, and unknown specs.")

    if has_faq and _faq_question_count(body_html, text) < 3:
        score -= 6
        signals.append("thin FAQ depth")
        recommendations.append("Expand FAQ to at least 3 real search/buyer questions with direct answers.")

    if has_internal_links and _has_generic_anchor_text(body_html):
        score -= 6
        signals.append("generic internal-link anchors")
        recommendations.append("Use descriptive anchor text that names the product, collection, or next decision.")

    if has_external_references and _has_unsupported_reference_language(normalized):
        score -= 6
        signals.append("vague reference framing")
        recommendations.append("Tie every citation to a specific trend, source, or fact instead of saying sources suggest.")

    if _count_tables(body_html) == 0 and has_decision_support:
        score -= 4
        signals.append("decision support lacks scannable structure")
        recommendations.append("Use a small comparison table or choose/skip matrix for fast shopping decisions.")

    formula_hits = [pattern for pattern in AI_FORMULA_PATTERNS if _pattern_in_text(pattern, normalized)]
    if formula_hits:
        score -= min(18, len(formula_hits) * 3)
        signals.append(f"formulaic AI patterns: {', '.join(formula_hits[:6])}")
        recommendations.append("Replace formulaic phrasing with exact product facts, shopper scenes, and direct verbs.")

    if _count_sections(body_html) < 4:
        score -= 8
        signals.append("thin section structure")
        recommendations.append("Use a research -> facts -> decision -> FAQ flow with clear H2 sections.")

    return DoctrineAssessment(
        score=max(0, min(100, score)),
        signals=signals,
        recommendations=_unique(recommendations),
        sources=[
            "Google Search Central: Creating helpful, reliable, people-first content",
            "Google Search Central: SEO starter guide",
            "ericosiu/ai-marketing-skills: content-ops humanizer and content quality rubric",
            "TheCraigHewitt/seomachine: article workflow and editor agent",
        ],
    )


def _pattern_in_text(pattern: str, text: str) -> bool:
    if "*" not in pattern:
        return pattern in text
    left, _, right = pattern.partition("*")
    return bool(left.strip() and right.strip() and left.strip() in text and right.strip() in text)


def _has_answer_first(text: str) -> bool:
    return any(marker in text for marker in ("quick answer", "short answer", "answer first", "bottom line", "快速答案", "直接答案", "结论先说"))


def _has_verified_fact_language(text: str) -> bool:
    return any(marker in text for marker in ("verified", "confirmed", "not confirmed", "not provided", "已确认", "未确认", "规格", "事实", "未提供"))


def _count_sections(html: str) -> int:
    return html.lower().count("<h2") + html.lower().count("<section")


def _count_tables(html: str) -> int:
    return html.lower().count("<table")


def _faq_question_count(html: str, text: str) -> int:
    heading_questions = re.findall(r"<h[23]\b[^>]*>.*?[?？].*?</h[23]>", html, re.I | re.S)
    inline_questions = re.findall(r"[^.?!。？！]{6,90}[?？]", text)
    return max(len(heading_questions), len(inline_questions))


def _has_generic_anchor_text(html: str) -> bool:
    generic = {"click here", "here", "read more", "learn more", "link", "this article", "点击这里", "了解更多", "阅读更多", "打开链接"}
    labels = [_normalize(_strip_html(match.group(1))) for match in re.finditer(r"<a\b[^>]*>(.*?)</a>", html, re.I | re.S)]
    return any(label in generic for label in labels)


def _has_unsupported_reference_language(text: str) -> bool:
    return any(marker in text for marker in ("sources suggest", "reports say", "experts believe", "industry reports", "有资料显示", "业内认为"))


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


def _normalize(value: str) -> str:
    return " ".join(value.lower().split())


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output
