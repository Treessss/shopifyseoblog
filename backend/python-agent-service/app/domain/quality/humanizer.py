from __future__ import annotations

from dataclasses import dataclass
import re

from app.domain.quality.patterns import AI_SLOP_PHRASES


@dataclass(slots=True)
class HumanizerAssessment:
    score: int
    signals: list[str]
    recommendations: list[str]


def assess_humanizer(text: str, banned_words: list[str] | None = None) -> HumanizerAssessment:
    body = _normalize(text)
    visible_text = _strip_html(text)
    signals: list[str] = []
    recommendations: list[str] = []
    score = 100

    banned_hits = [word for word in (banned_words or []) if word and word.lower() in body]
    if banned_hits:
        penalty = min(20, len(banned_hits) * 4)
        score -= penalty
        signals.append(f"brand banned words: {', '.join(sorted(set(banned_hits)))}")
        recommendations.append("Replace brand-unsafe phrases with concrete shopper language.")

    slop_hits = [phrase for phrase in AI_SLOP_PHRASES if phrase in body]
    if slop_hits:
        penalty = min(24, len(slop_hits) * 3)
        score -= penalty
        signals.append(f"ai slop phrases: {', '.join(slop_hits[:6])}")
        recommendations.append("Remove vague AI phrasing and use simple verbs with exact details.")

    template_hits = [phrase for phrase in _template_phrases() if phrase in body]
    if template_hits:
        penalty = min(24, len(template_hits) * 4)
        score -= penalty
        signals.append(f"template phrases: {', '.join(template_hits[:6])}")
        recommendations.append("Break up formulaic intros, transitions, and closing lines.")

    if _count_sentences(text) < 4:
        score -= 10
        signals.append("thin paragraph structure")
        recommendations.append("Add more short, concrete paragraphs and a real comparison or caveat.")

    if _sentence_start_repetition(text):
        score -= 12
        signals.append("repeated sentence openings")
        recommendations.append("Vary sentence openings and remove mechanical rhythm.")

    pattern_penalty, pattern_signals, pattern_recommendations = _pattern_penalties(text, visible_text, body)
    if pattern_penalty:
        score -= pattern_penalty
        signals.extend(pattern_signals)
        recommendations.extend(pattern_recommendations)

    if _info_gain_signals(body) < 3:
        score -= 16
        signals.append("low information gain")
        recommendations.append("Add facts, caveats, decision checks, internal links, or FAQ details.")

    if _has_formulaic_closing(body):
        score -= 8
        signals.append("generic conclusion")
        recommendations.append("Replace generic positive wrap-ups with a concrete next step.")

    return HumanizerAssessment(
        score=max(0, min(100, score)),
        signals=_unique(signals),
        recommendations=_unique(recommendations),
    )


def _normalize(value: str) -> str:
    return " ".join(value.lower().split())


def _template_phrases() -> list[str]:
    return [
        "in today's fast-paced world",
        "it is important to note",
        "delve into",
        "game changer",
        "look no further",
        "in conclusion",
        "本文将深入探讨",
        "不言而喻",
        "总的来说",
        "综上所述",
        "值得注意的是",
        "越来越多的人",
        "写作时要",
        "在当今快节奏的世界",
        "这不仅仅是",
        "更是",
    ]


def _count_sentences(text: str) -> int:
    sentences = [part.strip() for part in text.replace("?", ".").replace("!", ".").split(".")]
    return sum(1 for sentence in sentences if len(sentence) >= 12)


def _sentence_start_repetition(text: str) -> bool:
    sentences = [part.strip() for part in text.replace("?", ".").replace("!", ".").split(".")]
    starts: dict[str, int] = {}
    for sentence in sentences:
        tokens = [token for token in sentence.split() if token]
        start = " ".join(tokens[:3]).lower()
        if len(start) < 4:
            continue
        starts[start] = starts.get(start, 0) + 1
    return any(count >= 3 for count in starts.values())


def _info_gain_signals(text: str) -> int:
    signals = 0
    if any(marker in text for marker in ("<table", "<a ")):
        signals += 1
    if any(marker in text for marker in ("verified", "confirmed", "已确认", "未确认", "规格", "事实")):
        signals += 1
    if any(marker in text for marker in ("choose", "skip", "适合", "不适合", "下单前", "购买前", "compare", "对比")):
        signals += 1
    if any(marker in text for marker in ("faq", "常见问题", "?")):
        signals += 1
    return signals


def _has_formulaic_closing(text: str) -> bool:
    return any(
        marker in text
        for marker in (
            "in conclusion",
            "to sum up",
            "总的来说",
            "综上所述",
            "未来",
            "exciting times",
            "future looks bright",
            "continues their journey",
        )
    )


def _pattern_penalties(raw_html: str, visible_text: str, normalized: str) -> tuple[int, list[str], list[str]]:
    checks: list[tuple[bool, int, str, str]] = [
        (
            _has_significance_inflation(normalized),
            10,
            "significance inflation",
            "Cut inflated importance claims and replace them with exact product or shopper facts.",
        ),
        (
            _has_vague_attribution(normalized),
            8,
            "vague attribution",
            "Name the source, date, or evidence behind any market, trend, or expert claim.",
        ),
        (
            _has_superficial_ing_analysis(visible_text),
            8,
            "superficial -ing analysis",
            "Split dangling -ing clauses into specific facts, causes, or shopper consequences.",
        ),
        (
            _has_negative_parallelism(normalized),
            6,
            "not-only-but-also pattern",
            "Replace not-only/but-also framing with one direct sentence.",
        ),
        (
            _has_false_range(normalized),
            6,
            "false range phrasing",
            "Avoid From X to Y ranges unless the two ends form a real scale.",
        ),
        (
            _has_rule_of_three_overuse(visible_text),
            7,
            "rule-of-three overuse",
            "Use lists only when each item adds a distinct decision point.",
        ),
        (
            _em_dash_overuse(visible_text),
            5,
            "em dash overuse",
            "Use simple punctuation and shorter sentences instead of repeated em dashes.",
        ),
        (
            _boldface_overuse(raw_html),
            4,
            "overuse of boldface",
            "Reserve bold text for rare, high-value labels or remove it entirely.",
        ),
        (
            _inline_header_list(raw_html),
            5,
            "inline-header list pattern",
            "Rewrite mechanical bold-label lists into natural bullets or a table.",
        ),
        (
            _title_case_heading_overuse(raw_html),
            4,
            "title-case headings",
            "Use natural sentence-case headings unless the brand style guide requires title case.",
        ),
        (
            _has_collaborative_artifacts(normalized),
            10,
            "assistant artifact phrasing",
            "Remove chat-style phrases such as 'of course', 'hope this helps', or 'let me know'.",
        ),
        (
            _has_cutoff_disclaimer(normalized),
            10,
            "knowledge-cutoff disclaimer",
            "Replace generic availability disclaimers with concrete verified/unknown facts.",
        ),
        (
            _has_excessive_hedging(normalized),
            8,
            "excessive hedging",
            "State what is known, what is unknown, and what the shopper should verify.",
        ),
    ]
    active = [check for check in checks if check[0]]
    penalty = min(42, sum(item[1] for item in active))
    signals = [item[2] for item in active]
    recommendations = [item[3] for item in active]
    return penalty, signals, recommendations


def _has_significance_inflation(text: str) -> bool:
    return any(
        marker in text
        for marker in (
            "stands as",
            "serves as a testament",
            "pivotal moment",
            "underscores its importance",
            "reflects broader",
            "setting the stage",
            "indelible mark",
            "deeply rooted",
            "意义重大",
            "标志着",
            "深刻体现",
        )
    )


def _has_vague_attribution(text: str) -> bool:
    return any(
        marker in text
        for marker in (
            "industry reports",
            "experts argue",
            "experts believe",
            "some critics argue",
            "several sources",
            "many people say",
            "data shows",
            "studies show",
            "有数据显示",
            "业内人士认为",
            "专家认为",
            "不少人认为",
        )
    )


def _has_superficial_ing_analysis(text: str) -> bool:
    hits = re.findall(r"\b(?:highlighting|underscoring|emphasizing|ensuring|reflecting|symbolizing|contributing|fostering|showcasing)\b", text, re.I)
    return len(hits) >= 2


def _has_negative_parallelism(text: str) -> bool:
    return any(marker in text for marker in ("not only", "but also", "not just", "not merely", "不仅", "还", "不只是", "更是"))


def _has_false_range(text: str) -> bool:
    return bool(re.search(r"\bfrom\s+[^.?!]{3,80}\s+to\s+[^.?!]{3,80}", text)) or "从" in text and "到" in text and "各个方面" in text


def _has_rule_of_three_overuse(text: str) -> bool:
    comma_triples = re.findall(r"\b[\w'-]+,\s+[\w'-]+,\s+(?:and\s+)?[\w'-]+\b", text)
    cjk_triples = re.findall(r"[\u3400-\u9fff]{2,6}、[\u3400-\u9fff]{2,6}、[\u3400-\u9fff]{2,6}", text)
    return len(comma_triples) + len(cjk_triples) >= 3


def _em_dash_overuse(text: str) -> bool:
    words = max(1, len(re.findall(r"[\w\u3400-\u9fff]+", text)))
    return text.count("—") > max(1, words // 200)


def _boldface_overuse(html: str) -> bool:
    bold_count = len(re.findall(r"<(?:strong|b)\b", html, re.I)) + html.count("**")
    words = max(1, len(re.findall(r"[\w\u3400-\u9fff]+", _strip_html(html))))
    return bold_count >= 6 and bold_count > words / 120


def _inline_header_list(html: str) -> bool:
    return len(re.findall(r"<li>\s*<(?:strong|b)\b[^>]*>[^<]{2,40}:?</(?:strong|b)>", html, re.I)) >= 3


def _title_case_heading_overuse(html: str) -> bool:
    headings = re.findall(r"<h[2-4]\b[^>]*>(.*?)</h[2-4]>", html, re.I | re.S)
    title_case_count = 0
    for heading in headings:
        text = _strip_html(heading)
        words = re.findall(r"\b[A-Z][a-z]{2,}\b", text)
        if len(words) >= 3 and len(words) >= max(3, len(re.findall(r"\b[A-Za-z]{3,}\b", text)) - 1):
            title_case_count += 1
    return len(headings) >= 3 and title_case_count >= 3


def _has_collaborative_artifacts(text: str) -> bool:
    return any(
        marker in text
        for marker in (
            "i hope this helps",
            "hope this helps",
            "of course",
            "certainly",
            "great question",
            "let me know",
            "would you like",
            "当然可以",
            "希望这有帮助",
        )
    )


def _has_cutoff_disclaimer(text: str) -> bool:
    return any(
        marker in text
        for marker in (
            "as of my last update",
            "as of my knowledge cutoff",
            "while specific details are limited",
            "based on available information",
            "截至我所知",
            "由于资料有限",
        )
    )


def _has_excessive_hedging(text: str) -> bool:
    return any(
        marker in text
        for marker in (
            "could potentially",
            "might possibly",
            "it could be argued",
            "may have some",
            "有可能会",
            "或许可能",
            "一定程度上",
        )
    )


def _strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value).replace("\xa0", " ")


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output
