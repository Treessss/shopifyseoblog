import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from "./locales";
import type {
  ArticleDraft,
  ContentSourceContext,
  EditorialQualityResult,
  HtmlAssembler,
  HtmlAssemblyResult,
  KeywordEvidenceItem,
  KeywordPlan,
  KeywordPlanner,
  NormalizedContentPipelineInput,
  PromptBuilder,
  PromptBundle,
  QualityGate,
  QualityGateResult,
  SeoCheck,
  SeoScorer,
  SeoScoreResult,
  TopicCandidate,
  TopicSelectionResult
} from "./types";

export const defaultKeywordPlanner: KeywordPlanner = {
  plan(input, context) {
    const locale = normalizeLocale(input.locale);
    const topic = resolveTopic(input, context);
    const evidenceItems = buildKeywordEvidence(input, context);
    const primaryKeyword = cleanKeyword(input.primaryKeyword ?? context.topicSelection?.selected.primaryKeyword ?? context.seedKeywords?.[0] ?? topic);
    const secondaryKeywords = unique([
      ...(context.seedKeywords ?? []),
      ...trendKeywordCandidates(context),
      ...localizedKeywordVariants(primaryKeyword, locale),
      context.product?.productType,
      context.product?.vendor,
      context.collection?.title
    ]).filter((keyword) => keyword !== primaryKeyword);

    return {
      locale,
      primaryKeyword,
      secondaryKeywords: secondaryKeywords.slice(0, 8),
      longTailKeywords: unique([
        ...localizedLongTailKeywords(primaryKeyword, topic, locale),
        ...trendLongTailKeywords(primaryKeyword, context, locale)
      ]).slice(0, 8),
      searchIntent: input.sourceType === "manual_topic" ? "informational" : "commercial",
      audienceNeed: locale === "zh-CN" ? `理解 ${primaryKeyword} 的选择、使用和购买决策` : `Understand how to choose and use ${primaryKeyword}`,
      evidence: formatKeywordEvidence(evidenceItems),
      evidenceItems
    };
  }
};

export const defaultPromptBuilder: PromptBuilder = {
  build(input, context, keywords) {
    const language = localeInstruction(input.locale);
    const voice = context.brandVoice?.tone ? `Tone: ${context.brandVoice.tone}.` : "Tone: clear, useful, and brand-safe.";
    const audience = context.brandVoice?.audience ? `Audience: ${context.brandVoice.audience}.` : "Audience: store shoppers and search visitors.";
    const bannedWords = context.brandVoice?.bannedWords?.length
      ? `Avoid these words: ${context.brandVoice.bannedWords.join(", ")}.`
      : "Avoid unsupported claims and exaggerated guarantees.";
    const trendContext = trendContextLine(context);
    const internalLinks = internalLinkInstruction(context);
    const imageBrief = imagePromptInstruction(context);

    const system = [
      `Write in ${language}.`,
      "You are an ecommerce SEO editor for a Shopify store.",
      "Use evidence carefully: trend and news signals are angle inputs, not permission to fabricate facts.",
      voice,
      audience,
      bannedWords
    ].join(" ");

    return {
      system,
      outlinePrompt: [
        `Create an SEO outline for topic: ${input.topic}.`,
        `Primary keyword: ${keywords.primaryKeyword}.`,
        `Secondary keywords: ${keywords.secondaryKeywords.join(", ")}.`,
        keywords.evidence?.length ? `Keyword evidence: ${keywords.evidence.join(" | ")}.` : "",
        `Target length: ${input.targetWordCount} words.`,
        "Return title, summary, H2 sections, shopper intent, FAQs, and image alt text."
      ]
        .filter(Boolean)
        .join("\n"),
      draftPrompt: [
        `Draft the article in ${language} using the approved outline.`,
        `Primary keyword must appear naturally in title, opening paragraph, at least one H2, and conclusion: ${keywords.primaryKeyword}.`,
        "Use concise HTML-ready paragraphs, no markdown fences, no fabricated discounts or medical claims.",
        "Vary paragraph rhythm and examples. Avoid generic filler, repetitive sentence starts, and obvious template phrasing.",
        productContextLine(context),
        trendContext,
        internalLinks,
        imageBrief
      ]
        .filter(Boolean)
        .join("\n")
    };
  }
};

export const defaultHtmlAssembler: HtmlAssembler = {
  assemble(input, context, keywords, draft) {
    const sections = draft.sections
      .map((section) => {
        const bullets = section.bulletPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("");
        const paragraph = sectionParagraph(section.heading, section.intent, keywords, input.locale);
        return `<section><h2>${escapeHtml(section.heading)}</h2><p>${paragraph}</p><ul>${bullets}</ul></section>`;
      })
      .join("");

    const bodyHtml = [
      `<p>${escapeHtml(draft.intro)}</p>`,
      sections,
      context.product?.imageUrls?.[0]
        ? `<figure><img src="${escapeHtml(context.product.imageUrls[0])}" alt="${escapeHtml(draft.imageAlt ?? draft.title)}" /></figure>`
        : "",
      relatedLinksHtml(context, input.locale),
      `<p>${escapeHtml(draft.conclusion)}</p>`
    ].join("");

    return {
      title: draft.title,
      handle: draft.handle ?? stableHandle(draft.title),
      summary: draft.summary,
      bodyHtml,
      tags: unique([keywords.primaryKeyword, ...keywords.secondaryKeywords, ...draft.tags]).slice(0, 12),
      imagePrompt: draft.imagePrompt,
      imageAlt: draft.imageAlt
    };
  }
};

export const defaultSeoScorer: SeoScorer = {
  score(article, keywords, input) {
    const bodyText = stripHtml(article.bodyHtml);
    const headingCount = countMatches(article.bodyHtml, /<h2\b/gi);
    const primary = keywords.primaryKeyword.toLowerCase();
    const title = article.title.toLowerCase();
    const summary = article.summary.toLowerCase();
    const body = bodyText.toLowerCase();
    const wordCount = estimateWordCount(bodyText, input.locale);
    const secondaryHits = keywords.secondaryKeywords.filter((keyword) => body.includes(keyword.toLowerCase())).length;

    const checks: SeoCheck[] = [
      check("title-primary", "Primary keyword in title", title.includes(primary), 20),
      check("summary-primary", "Primary keyword in summary", summary.includes(primary), 12),
      check("body-primary", "Primary keyword in body", body.includes(primary), 18),
      check("heading-depth", "At least three H2 sections", headingCount >= 3, 12),
      check("target-depth", "Draft has useful depth", wordCount >= Math.max(120, Math.floor(input.targetWordCount * 0.25)), 14),
      check("title-length", "Title is scannable", article.title.length >= 8 && article.title.length <= 72, 8),
      check("secondary-coverage", "Secondary keyword coverage", secondaryHits >= Math.min(2, keywords.secondaryKeywords.length), 10),
      check("html-structure", "HTML has semantic sections", article.bodyHtml.includes("<section>") && article.bodyHtml.includes("</section>"), 6)
    ];

    const score = Math.min(100, checks.reduce((total, item) => total + item.points, 0));
    return {
      score,
      checks,
      recommendations: checks.filter((item) => !item.passed).map((item) => item.label)
    };
  }
};

export const defaultQualityGate: QualityGate = {
  evaluate(article, seo, input, context) {
    const qualityConfig = context.generationConfig?.qualityGate;
    const minSeoScore = qualityConfig?.minSeoScore ?? 72;
    const wordCount = estimateWordCount(stripHtml(article.bodyHtml), input.locale);
    const minWords = Math.max(120, Math.floor(input.targetWordCount * 0.25));
    const body = stripHtml(article.bodyHtml).toLowerCase();
    const bannedWords = context.brandVoice?.bannedWords ?? [];
    const blockedWords = bannedWords.filter((word) => word && body.includes(word.toLowerCase()));
    const editorial = evaluateEditorialQuality(article, input.locale);
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (seo.score < minSeoScore) reasons.push(`SEO score ${seo.score} is below ${minSeoScore}.`);
    if (wordCount < minWords) reasons.push(`Estimated word count ${wordCount} is below ${minWords}.`);
    if (blockedWords.length > 0) reasons.push(`Banned words found: ${blockedWords.join(", ")}.`);
    if (qualityConfig?.enabled !== false && editorial.score < (qualityConfig?.minEditorialScore ?? 0)) {
      reasons.push(`Editorial quality score ${editorial.score} is below ${qualityConfig?.minEditorialScore ?? 0}.`);
    }
    if (qualityConfig?.requireTrendEvidence && !context.trendSignals?.length) {
      reasons.push("Trend evidence was required but no relevant trend/news signals were found.");
    }
    if (qualityConfig?.rejectTemplatePatterns !== false && editorial.signals.some((signal) => signal.includes("template"))) {
      reasons.push("Template-like writing patterns were detected.");
    }
    if (!article.summary) warnings.push("Missing article summary.");
    if (!article.imageAlt) warnings.push("Missing image alt text.");
    if (context.generationConfig?.internalLinks?.enabled && !article.bodyHtml.includes("<a ")) {
      warnings.push("Internal links were requested but no anchor tag was found.");
    }

    return {
      passed: reasons.length === 0,
      minSeoScore,
      seoScore: seo.score,
      wordCount,
      reasons,
      warnings,
      editorial
    };
  }
};

export function buildDefaultDraft(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext,
  keywords: KeywordPlan
): ArticleDraft {
  const locale = normalizeLocale(input.locale);
  const topic = resolveTopic(input, context);
  const title =
    locale === "zh-CN"
      ? `${keywords.primaryKeyword}指南：${topic}的选择、使用与优化`
      : `${keywords.primaryKeyword} Guide: Choosing, Using, and Optimizing ${topic}`;
  const summary =
    locale === "zh-CN"
      ? `围绕${keywords.primaryKeyword}，整理适合 Shopify 店铺博客的选购要点、使用建议和常见问题，帮助用户更快做出判断。`
      : `A practical Shopify blog guide to ${keywords.primaryKeyword}, covering selection criteria, usage tips, and common shopper questions.`;

  const sections =
    locale === "zh-CN"
      ? [
          section(`为什么关注${keywords.primaryKeyword}`, "match-intent", [
            `${keywords.primaryKeyword}不仅影响搜索流量，也会影响用户进入商品页前的信任感。`,
            `先说明适用场景，再连接到${topic}的真实需求。`
          ]),
          section(`如何判断${keywords.primaryKeyword}是否适合你`, "comparison", [
            "比较材质、功能、预算和维护成本，避免只按单一卖点做决定。",
            "把商品描述、评价和使用场景放在同一个判断框架里。"
          ]),
          section(`${keywords.primaryKeyword}的使用与搭配建议`, "usage", [
            "用清晰步骤说明上手方法，并提醒用户关注尺寸、兼容性或护理方式。",
            "自然引入相关商品、系列或博客内容，形成内部链接机会。"
          ]),
          section(`${keywords.primaryKeyword}常见问题`, "faq", [
            "回答购买前最常见的疑问，包括适用人群、保养方式和下单前检查点。",
            "保持答案具体、克制，避免无法验证的绝对化承诺。"
          ])
        ]
      : [
          section(`Why ${keywords.primaryKeyword} matters`, "match-intent", [
            `${keywords.primaryKeyword} shapes both organic discovery and buyer confidence before shoppers reach a product page.`,
            `Start with the use case, then connect it to the practical needs behind ${topic}.`
          ]),
          section(`How to choose the right ${keywords.primaryKeyword}`, "comparison", [
            "Compare materials, functions, budget, and maintenance instead of relying on one selling point.",
            "Use product descriptions, reviews, and use cases in one decision framework."
          ]),
          section(`${keywords.primaryKeyword} usage and pairing ideas`, "usage", [
            "Explain setup steps clearly and call out sizing, compatibility, or care requirements.",
            "Introduce related products, collections, or blog content as natural internal-link opportunities."
          ]),
          section(`${keywords.primaryKeyword} FAQs`, "faq", [
            "Answer pre-purchase questions about fit, care, and checks before ordering.",
            "Keep answers concrete and avoid claims that cannot be verified."
          ])
        ];

  return {
    title,
    handle: stableHandle(title),
    summary,
    intro:
      locale === "zh-CN"
        ? `${keywords.primaryKeyword}是一篇 Shopify 店铺博客可以持续获取自然流量的主题。本文从用户意图、选择标准、使用场景和常见问题出发，帮助读者把${topic}和实际购买决策连接起来。`
        : `${keywords.primaryKeyword} is a durable topic for Shopify blog traffic. This guide connects ${topic} with shopper intent, selection criteria, usage context, and common questions.`,
    sections,
    conclusion:
      locale === "zh-CN"
        ? `围绕${keywords.primaryKeyword}写作时，最重要的是让搜索意图、商品价值和真实使用场景保持一致。这样文章既能服务 SEO，也能帮助读者更有信心地进入下一步。`
        : `When writing about ${keywords.primaryKeyword}, align search intent, product value, and real usage context. That makes the article useful for SEO and more helpful for shoppers.`,
    tags: [keywords.primaryKeyword, ...keywords.secondaryKeywords.slice(0, 4)],
    imagePrompt: buildDetailedImagePrompt(input, context, keywords),
    imageAlt: locale === "zh-CN" ? `${keywords.primaryKeyword}使用场景图` : `${keywords.primaryKeyword} usage context`
  };
}

export function evaluateEditorialQuality(article: HtmlAssemblyResult, locale: SupportedLocale = DEFAULT_LOCALE): EditorialQualityResult {
  const text = stripHtml(article.bodyHtml);
  const sentences = splitSentences(text);
  const signals: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  const repeatedStarts = repeatedSentenceStarts(sentences);
  if (repeatedStarts.length > 0) {
    score -= Math.min(24, repeatedStarts.length * 8);
    signals.push(`repeated sentence starts: ${repeatedStarts.join(", ")}`);
    recommendations.push("Vary sentence openings and paragraph rhythm.");
  }

  const templateHits = templatePhrases(text, locale);
  if (templateHits.length > 0) {
    score -= Math.min(28, templateHits.length * 7);
    signals.push(`template phrases: ${templateHits.join(", ")}`);
    recommendations.push("Replace generic AI-like phrases with concrete product or shopper examples.");
  }

  const paragraphCount = countMatches(article.bodyHtml, /<p\b/gi);
  if (paragraphCount < 3) {
    score -= 10;
    signals.push("thin paragraph structure");
    recommendations.push("Add varied paragraphs with examples, caveats, and practical details.");
  }

  const sentenceLengths = sentences.map((sentence) => estimateWordCount(sentence, locale)).filter((count) => count > 0);
  const uniqueLengths = new Set(sentenceLengths.slice(0, 12)).size;
  if (sentenceLengths.length >= 6 && uniqueLengths <= 3) {
    score -= 12;
    signals.push("low sentence-length variation");
    recommendations.push("Mix short and longer explanatory sentences.");
  }

  return {
    score: clampScore(score),
    passed: score >= 72,
    signals,
    recommendations
  };
}

export function normalizePipelineLocale(locale?: string | SupportedLocale | null): SupportedLocale {
  return normalizeLocale(locale ?? DEFAULT_LOCALE);
}

export function stableHandle(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return ascii || `article-${hashString(value).toString(36)}`;
}

export function estimateWordCount(text: string, locale: SupportedLocale = DEFAULT_LOCALE): number {
  const clean = text.trim();
  if (!clean) return 0;

  if (locale === "zh-CN" || locale === "ja-JP") {
    const cjkChars = clean.match(/[\u3400-\u9fff\u3040-\u30ff]/g)?.length ?? 0;
    const latinWords = clean.match(/[a-z0-9]+/gi)?.length ?? 0;
    return Math.ceil(cjkChars * 0.6 + latinWords);
  }

  return clean.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function localizedKeywordVariants(primaryKeyword: string, locale: SupportedLocale): string[] {
  if (locale === "zh-CN") {
    return [`${primaryKeyword}选购`, `${primaryKeyword}指南`, `${primaryKeyword}推荐`, `${primaryKeyword}使用方法`, `${primaryKeyword}常见问题`];
  }

  return [`${primaryKeyword} guide`, `best ${primaryKeyword}`, `${primaryKeyword} tips`, `${primaryKeyword} FAQ`, `how to choose ${primaryKeyword}`];
}

function localizedLongTailKeywords(primaryKeyword: string, topic: string, locale: SupportedLocale): string[] {
  if (locale === "zh-CN") {
    return [`${primaryKeyword}怎么选`, `${topic}购买前要看什么`, `${primaryKeyword}适合哪些人`];
  }

  return [`how to choose ${primaryKeyword}`, `${topic} buying guide`, `who should use ${primaryKeyword}`];
}

function resolveTopic(input: NormalizedContentPipelineInput, context: ContentSourceContext): string {
  return input.topic || context.topic || context.product?.title || context.collection?.title || "Shopify blog topic";
}

function cleanKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ");
}

function localeInstruction(locale: SupportedLocale): string {
  const labels: Record<SupportedLocale, string> = {
    "zh-CN": "Simplified Chinese",
    "en-US": "English",
    "ja-JP": "Japanese",
    "de-DE": "German",
    "fr-FR": "French",
    "es-ES": "Spanish"
  };

  return labels[locale];
}

function productContextLine(context: ContentSourceContext): string {
  if (!context.product) return "";
  return `Product context: ${context.product.title}; vendor ${context.product.vendor ?? "unknown"}; type ${context.product.productType ?? "unknown"}.`;
}

function trendContextLine(context: ContentSourceContext): string {
  const signals = context.trendSignals?.slice(0, 5) ?? [];
  if (signals.length === 0) return "";

  return [
    "Relevant trend/news signals to use as grounded angles:",
    ...signals.map((signal, index) =>
      `${index + 1}. ${signal.title}${signal.source ? ` (${signal.source})` : ""}${signal.url ? ` ${signal.url}` : ""}`
    ),
    "Mention a trend only when it directly supports the product or category angle; avoid claiming facts beyond the supplied signal."
  ].join("\n");
}

function internalLinkInstruction(context: ContentSourceContext): string {
  if (context.generationConfig?.internalLinks?.enabled === false) return "";
  const links = context.internalLinks?.slice(0, context.generationConfig?.internalLinks?.maxLinks ?? 4) ?? [];
  if (links.length === 0) return "";

  return [
    "Insert these internal links naturally where they help the reader:",
    ...links.map((link) => `- ${link.anchor ?? link.title}: ${link.url} (${link.type})`)
  ].join("\n");
}

function imagePromptInstruction(context: ContentSourceContext): string {
  if (context.generationConfig?.imageGeneration?.enabled === false) return "";
  const imageConfig = context.generationConfig?.imageGeneration;
  const limit = imageConfig?.referenceImageLimit ?? context.generationConfig?.productImageReference?.maxImages ?? 6;
  const references = context.imageReferences?.slice(0, limit) ?? [];
  const referenceText = references.length
    ? `Use product image references as visual grounding: ${references.map((item) => item.url).join(", ")}.`
    : "If no product reference image is available, describe a realistic ecommerce editorial scene.";
  const scene = imageConfig?.scenePrompt ? `Required scene: ${imageConfig.scenePrompt}.` : "";
  const fusion =
    imageConfig?.fusionMode === "multi_product_fusion"
      ? "Fuse all referenced products into one coherent lifestyle scene; preserve product identity, proportions, colors, and visible details; do not create a collage."
      : imageConfig?.fusionMode === "single_product"
        ? "Prioritize one hero product with supporting context."
        : "Create a realistic lifestyle scene that makes the product use case immediately clear.";

  return [
    "Create a detailed image prompt for the article.",
    referenceText,
    scene,
    fusion,
    "The prompt should name the product/category, scene, composition, lighting, background, aspect ratio, and what to avoid."
  ]
    .filter(Boolean)
    .join(" ");
}

function trendKeywordCandidates(context: ContentSourceContext): string[] {
  return (context.trendSignals ?? [])
    .flatMap((signal) => tokenizeSignal(signal.title))
    .filter((token) => token.length >= 3)
    .slice(0, 12);
}

function trendLongTailKeywords(primaryKeyword: string, context: ContentSourceContext, locale: SupportedLocale): string[] {
  const signals = context.trendSignals?.slice(0, 3) ?? [];
  if (signals.length === 0) return [];

  if (locale === "zh-CN") {
    return signals.map((signal) => `${primaryKeyword}与${compactTitle(signal.title)}趋势`);
  }

  return signals.map((signal) => `${primaryKeyword} and ${compactTitle(signal.title)} trend`);
}

export function buildKeywordEvidence(
  input: Pick<NormalizedContentPipelineInput, "primaryKeyword" | "topic">,
  context: ContentSourceContext
): KeywordEvidenceItem[] {
  const evidence: KeywordEvidenceItem[] = [];

  if (input.primaryKeyword) {
    evidence.push({
      type: "seed_keyword",
      source: "campaign",
      label: "Seed keyword",
      value: input.primaryKeyword,
      metric: "user supplied",
      confidence: 95
    });
  }

  for (const keyword of context.seedKeywords ?? []) {
    evidence.push({
      type: "seed_keyword",
      source: "campaign",
      label: "Campaign keyword",
      value: keyword,
      metric: "campaign seed",
      confidence: 86
    });
  }

  if (context.product?.title) {
    evidence.push({
      type: "product",
      source: "Shopify product snapshot",
      label: context.product.productType ?? "Product",
      value: context.product.title,
      snippet: [context.product.vendor, context.product.tags.slice(0, 4).join(", ")].filter(Boolean).join(" · "),
      metric: context.product.imageUrls.length ? `${context.product.imageUrls.length} product images` : undefined,
      confidence: 82
    });
  }

  if (context.collection?.title) {
    evidence.push({
      type: "collection",
      source: "Shopify collection snapshot",
      label: "Collection",
      value: context.collection.title,
      snippet: stripHtml(context.collection.description ?? "").slice(0, 160) || undefined,
      metric: context.collection.imageUrls?.length ? `${context.collection.imageUrls.length} collection images` : undefined,
      confidence: 78
    });
  }

  for (const signal of context.trendSignals?.slice(0, 6) ?? []) {
    evidence.push({
      type: "trend",
      source: signal.source || "trend feed",
      label: "Trend/news signal",
      value: signal.title,
      url: signal.url,
      snippet: signal.summary,
      publishedAt: signal.publishedAt,
      metric: [signal.traffic ? `traffic ${signal.traffic}` : "", `relevance ${signal.relevanceScore ?? 0}`].filter(Boolean).join(" · "),
      relevanceScore: signal.relevanceScore,
      confidence: clampScore(62 + (signal.relevanceScore ?? 0) * 6 + trafficBoost(signal.traffic))
    });
  }

  for (const link of context.internalLinks?.slice(0, 4) ?? []) {
    evidence.push({
      type: "internal_link",
      source: "store internal links",
      label: link.type,
      value: link.anchor ?? link.title,
      url: link.url,
      snippet: link.reason,
      metric: "available internal link",
      confidence: 70
    });
  }

  return uniqueEvidence(evidence);
}

export function formatKeywordEvidence(items: KeywordEvidenceItem[]): string[] {
  return items.slice(0, 10).map((item) => {
    const parts = [
      `${item.type}: ${item.value}`,
      item.source ? `source ${item.source}` : "",
      item.metric,
      item.url
    ].filter(Boolean);
    return parts.join(" · ");
  });
}

export function selectTopicCandidate(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext
): TopicSelectionResult {
  const evidence = buildKeywordEvidence(input, context);
  const maxCandidates = context.generationConfig?.topicDiscovery?.maxCandidates ?? 4;
  const locale = normalizeLocale(input.locale);
  const keyword = cleanKeyword(
    input.primaryKeyword ??
      context.seedKeywords?.[0] ??
      context.product?.productType ??
      context.product?.title ??
      context.collection?.title ??
      input.topic
  );
  const category = cleanKeyword(context.product?.productType ?? context.collection?.title ?? keyword);
  const candidates: TopicCandidate[] = [];

  if (input.topic && context.generationConfig?.topicDiscovery?.enabled === false) {
    candidates.push({
      topic: input.topic,
      primaryKeyword: keyword,
      score: 92,
      reasons: ["manual topic supplied"],
      evidence: evidence.slice(0, 6)
    });
  }

  for (const signal of context.trendSignals?.slice(0, maxCandidates) ?? []) {
    const signalEvidence = evidence.filter((item) => item.type === "trend" && item.value === signal.title);
    const topic =
      locale === "zh-CN"
        ? `${category}选题：${compactTitle(signal.title)}趋势下的选购与使用建议`
        : `${category} angle: buying and usage ideas around ${compactTitle(signal.title)}`;
    candidates.push({
      topic,
      primaryKeyword: keyword,
      score: clampScore(68 + (signal.relevanceScore ?? 0) * 8 + trafficBoost(signal.traffic)),
      reasons: ["trend matched to product/category", signal.traffic ? `trend traffic ${signal.traffic}` : "RSS trend signal"],
      evidence: [...signalEvidence, ...evidence.filter((item) => item.type !== "trend").slice(0, 4)]
    });
  }

  candidates.push({
    topic:
      locale === "zh-CN"
        ? `${keyword}购买前怎么选：场景、材质与搭配指南`
        : `How to choose ${keyword}: use cases, materials, and pairing ideas`,
    primaryKeyword: keyword,
    score: context.product || context.collection ? 74 : 62,
    reasons: ["stable product/category evergreen topic", "built from Shopify catalog context"],
    evidence: evidence.filter((item) => item.type !== "trend").slice(0, 6)
  });

  candidates.push({
    topic:
      locale === "zh-CN"
        ? `${keyword}常见问题：从搜索意图到下单前检查`
        : `${keyword} FAQs: from search intent to pre-purchase checks`,
    primaryKeyword: keyword,
    score: 69,
    reasons: ["SEO informational angle", "supports long-tail keyword coverage"],
    evidence: evidence.slice(0, 6)
  });

  const sorted = uniqueTopicCandidates(candidates)
    .filter((candidate) => candidate.score >= (context.generationConfig?.topicDiscovery?.minEvidenceScore ?? 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);
  const selected = sorted[0] ?? {
    topic: input.topic,
    primaryKeyword: keyword,
    score: 50,
    reasons: ["fallback topic"],
    evidence: evidence.slice(0, 6)
  };

  return {
    selected,
    candidates: sorted.length ? sorted : [selected]
  };
}

function relatedLinksHtml(context: ContentSourceContext, locale: SupportedLocale): string {
  const links = context.internalLinks?.slice(0, context.generationConfig?.internalLinks?.maxLinks ?? 4) ?? [];
  if (!context.generationConfig?.internalLinks?.enabled || links.length === 0) return "";

  const heading = locale === "zh-CN" ? "继续了解" : "Keep exploring";
  const items = links
    .map((link) => {
      const anchor = escapeHtml(link.anchor ?? link.title);
      return `<li><a href="${escapeHtml(link.url)}">${anchor}</a>${link.reason ? ` <span>${escapeHtml(link.reason)}</span>` : ""}</li>`;
    })
    .join("");

  return `<section><h2>${heading}</h2><ul>${items}</ul></section>`;
}

function buildDetailedImagePrompt(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext,
  keywords: KeywordPlan
): string {
  const locale = normalizeLocale(input.locale);
  const topic = resolveTopic(input, context);
  const product = context.product;
  const collection = context.collection;
  const references = context.imageReferences?.map((item) => item.url) ?? [];
  const imageConfig = context.generationConfig?.imageGeneration;
  const style = imageConfig?.promptStyle;
  const scene = imageConfig?.scenePrompt;
  const limit = imageConfig?.referenceImageLimit ?? context.generationConfig?.productImageReference?.maxImages ?? 6;
  const trend = context.trendSignals?.[0]?.title;
  const fusion =
    imageConfig?.fusionMode === "multi_product_fusion"
      ? locale === "zh-CN"
        ? "多图融合：把所有参考商品自然放入同一个真实场景，保留商品颜色、比例、材质和关键细节，不要拼贴图"
        : "Multi-image fusion: combine all referenced products into one coherent real scene, preserving color, scale, material, and key details; no collage"
      : imageConfig?.fusionMode === "single_product"
        ? locale === "zh-CN"
          ? "单品主视觉：突出一个核心商品，其他元素只做场景辅助"
          : "Single-product hero: emphasize one core product, with other elements only supporting the scene"
        : locale === "zh-CN"
          ? "生活方式场景：让使用场景清晰、真实、可购买"
          : "Lifestyle scene: make the use case clear, realistic, and shoppable";

  if (locale === "zh-CN") {
    return [
      `电商博客原创配图，主题：${keywords.primaryKeyword}`,
      `文章话题：${topic}`,
      product ? `产品：${product.title}，品类：${product.productType ?? "未标注"}，品牌/供应商：${product.vendor ?? "未标注"}` : "",
      collection ? `系列：${collection.title}` : "",
      trend ? `可参考的内容角度：${trend}` : "",
      scene ? `指定场景：${scene}` : "",
      references.length ? `参考产品图 URL：${references.slice(0, limit).join(", ")}` : "",
      fusion,
      "画面：真实电商编辑场景，自然光，干净背景，产品清晰可见，适合 Shopify 博客首图或正文插图",
      "构图：横向 16:9，留出少量文字安全区，不要品牌水印、不要虚假包装文字、不要夸张效果",
      style ? `风格补充：${style}` : ""
    ]
      .filter(Boolean)
      .join("；");
  }

  return [
    `Original ecommerce blog image for ${keywords.primaryKeyword}`,
    `Article topic: ${topic}`,
    product ? `Product: ${product.title}; type: ${product.productType ?? "unknown"}; vendor: ${product.vendor ?? "unknown"}` : "",
    collection ? `Collection: ${collection.title}` : "",
    trend ? `Grounded editorial angle: ${trend}` : "",
    scene ? `Required scene: ${scene}` : "",
    references.length ? `Reference product image URLs: ${references.slice(0, limit).join(", ")}` : "",
    fusion,
    "Scene: realistic ecommerce editorial setup, natural light, clean background, product clearly visible, suitable for a Shopify blog feature or inline image",
    "Composition: 16:9 horizontal, small text-safe area, no watermarks, no fake packaging text, no exaggerated effects",
    style ? `Style note: ${style}` : ""
  ]
    .filter(Boolean)
    .join("; ");
}

function section(heading: string, intent: string, bulletPoints: string[]) {
  return {
    heading,
    intent,
    bulletPoints,
    targetWords: 180
  };
}

function sectionParagraph(heading: string, intent: string, keywords: KeywordPlan, locale: SupportedLocale): string {
  if (locale === "zh-CN") {
    return escapeHtml(
      `${heading}需要同时覆盖搜索意图和购买场景。围绕${keywords.primaryKeyword}展开时，可以把${intent}、商品信息和用户疑问串起来，让内容更具体，也更容易转化为下一步行动。`
    );
  }

  return escapeHtml(
    `${heading} should cover both search intent and buying context. When discussing ${keywords.primaryKeyword}, connect ${intent}, product information, and shopper questions so the content becomes specific and action-oriented.`
  );
}

function check(id: string, label: string, passed: boolean, maxPoints: number): SeoCheck {
  return {
    id,
    label,
    passed,
    points: passed ? maxPoints : 0,
    maxPoints
  };
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function uniqueEvidence(items: KeywordEvidenceItem[]): KeywordEvidenceItem[] {
  const seen = new Set<string>();
  const output: KeywordEvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.value}:${item.url ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function uniqueTopicCandidates(items: TopicCandidate[]): TopicCandidate[] {
  const seen = new Set<string>();
  const output: TopicCandidate[] = [];
  for (const item of items) {
    const key = item.topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function trafficBoost(traffic?: string): number {
  if (!traffic) return 0;
  const match = traffic.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const multiplier = /m/i.test(traffic) ? 1000000 : /k/i.test(traffic) ? 1000 : 1;
  const normalized = value * multiplier;
  if (normalized >= 1000000) return 14;
  if (normalized >= 100000) return 10;
  if (normalized >= 10000) return 6;
  return 3;
}

function tokenizeSignal(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function compactTitle(value: string): string {
  return tokenizeSignal(value).slice(0, 5).join(" ");
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[。！？.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function repeatedSentenceStarts(sentences: string[]): string[] {
  const starts = new Map<string, number>();
  for (const sentence of sentences) {
    const start = sentence
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .slice(0, 3)
      .join(" ")
      .toLowerCase();
    if (start.length < 4) continue;
    starts.set(start, (starts.get(start) ?? 0) + 1);
  }

  return Array.from(starts.entries())
    .filter(([, count]) => count >= 3)
    .map(([start]) => start)
    .slice(0, 5);
}

function templatePhrases(text: string, locale: SupportedLocale): string[] {
  const lower = text.toLowerCase();
  const phrases =
    locale === "zh-CN"
      ? ["在当今", "不言而喻", "总的来说", "值得注意的是", "越来越多的人", "本文将深入探讨"]
      : [
          "in today's fast-paced world",
          "it is important to note",
          "delve into",
          "game changer",
          "look no further",
          "in conclusion"
        ];

  return phrases.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
