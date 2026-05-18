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

interface DraftAngle {
  locale: SupportedLocale;
  topic: string;
  primaryKeyword: string;
  anchorLabel: string;
  category: string;
  trendTitle?: string;
  productTitle?: string;
  collectionTitle?: string;
  theme: "trend" | "product_fit" | "comparison" | "care" | "faq";
}

export const defaultKeywordPlanner: KeywordPlanner = {
  plan(input, context) {
    const locale = normalizeLocale(input.locale);
    const topic = resolveTopic(input, context);
    const evidenceItems = buildKeywordEvidence(input, context);
    const primaryKeyword = cleanKeyword(
      firstNonBlank(
        input.primaryKeyword,
        context.topicSelection?.selected.primaryKeyword,
        context.seedKeywords?.[0],
        context.product?.productType,
        context.product?.title,
        context.collection?.title,
        topic
      ) ?? topic
    );
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
  const angle = resolveDraftAngle(input, context, keywords);
  const title = buildEditorialTitle(locale, angle);
  const summary = buildEditorialSummary(locale, angle);
  const sections = buildEditorialSections(locale, angle);

  return {
    title,
    handle: stableHandle(title),
    summary,
    intro:
      locale === "zh-CN"
        ? `${angle.primaryKeyword}这篇文章需要从真实商品和搜索意图出发。本文会围绕${angle.anchorLabel}，把${angle.topic}拆成可判断的购买场景、细节检查和搭配思路。`
        : `${angle.primaryKeyword} deserves a specific angle, not another generic buying guide. This article uses ${angle.anchorLabel} to connect ${angle.topic} with shopper intent, product context, and practical checks.`,
    sections,
    conclusion:
      locale === "zh-CN"
        ? `写好${angle.primaryKeyword}，关键是把证据、商品差异和用户场景放在一起。标题、内链和配图都应服务同一个具体角度，而不是套用固定导购模板。`
        : `Strong ${angle.primaryKeyword} content should keep evidence, product differences, and shopper context in the same lane. The title, internal links, and imagery all need to support that specific angle.`,
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

function resolveDraftAngle(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext,
  keywords: KeywordPlan
): DraftAngle {
  const locale = normalizeLocale(input.locale);
  const topic = context.topicSelection?.selected.topic ?? resolveTopic(input, context);
  const productTitle = context.product?.title;
  const collectionTitle = context.collection?.title;
  const category = firstNonBlank(context.product?.productType, collectionTitle, keywords.primaryKeyword) ?? keywords.primaryKeyword;
  const trendTitle = usableTrendSignals(context)[0]?.title;
  const anchorLabel = firstNonBlank(productTitle, collectionTitle, category) ?? category;
  const themes: DraftAngle["theme"][] = trendTitle
    ? ["trend", "product_fit", "comparison", "care"]
    : context.product
      ? ["product_fit", "comparison", "care", "faq"]
      : ["comparison", "care", "faq", "product_fit"];
  const theme = themes[Math.abs(hashString(`${topic}:${keywords.primaryKeyword}:${anchorLabel}`)) % themes.length];

  return {
    locale,
    topic,
    primaryKeyword: keywords.primaryKeyword,
    anchorLabel,
    category,
    trendTitle,
    productTitle,
    collectionTitle,
    theme
  };
}

function buildEditorialTitle(locale: SupportedLocale, angle: DraftAngle): string {
  if (locale === "zh-CN") {
    const titles: Record<DraftAngle["theme"], string> = {
      trend: `${compactTitle(angle.trendTitle ?? angle.topic)}之后，${angle.primaryKeyword}该怎么选？`,
      product_fit: `${angle.primaryKeyword}适合谁：从${angle.anchorLabel}看真实使用场景`,
      comparison: `${angle.primaryKeyword}别只看外观：${angle.category}购买前检查清单`,
      care: `${angle.primaryKeyword}怎么搭配更耐用：场景、细节和维护建议`,
      faq: `${angle.primaryKeyword}购买前最容易忽略的几个问题`
    };
    return titles[angle.theme];
  }

  const titles: Record<DraftAngle["theme"], string> = {
    trend: `What ${compactTitle(angle.trendTitle ?? angle.topic)} Means for ${angle.primaryKeyword}`,
    product_fit: `${angle.primaryKeyword}: Who ${angle.anchorLabel} Is Really For`,
    comparison: `Before You Buy ${angle.primaryKeyword}, Check These Details`,
    care: `${angle.primaryKeyword} in Daily Use: Pairing, Care, and Fit`,
    faq: `${angle.primaryKeyword} Questions Shoppers Should Ask First`
  };
  return titles[angle.theme];
}

function buildEditorialSummary(locale: SupportedLocale, angle: DraftAngle): string {
  if (locale === "zh-CN") {
    return [
      `围绕${angle.primaryKeyword}，这篇文章把${angle.anchorLabel}、${angle.category}和真实购买场景放在一起判断。`,
      angle.trendTitle ? `选题参考了「${angle.trendTitle}」这类热点信号，但只把它作为内容角度，不夸大事实。` : "",
      "读者可以快速看清适用场景、细节风险和下单前检查点。"
    ]
      .filter(Boolean)
      .join("");
  }

  return [
    `This article looks at ${angle.primaryKeyword} through ${angle.anchorLabel}, ${angle.category}, and real shopper use cases. `,
    angle.trendTitle ? `It uses “${angle.trendTitle}” as an editorial signal without overstating the facts. ` : "",
    "Readers get practical fit checks, tradeoffs, and pre-purchase questions instead of a generic buying template."
  ]
    .filter(Boolean)
    .join("");
}

function buildEditorialSections(locale: SupportedLocale, angle: DraftAngle) {
  if (locale === "zh-CN") {
    return [
      section(firstSectionHeading(angle), "evidence-angle", [
        angle.trendTitle ? `先说明「${angle.trendTitle}」和${angle.category}需求之间的关系。` : `先说明${angle.anchorLabel}解决的具体问题。`,
        `把${angle.primaryKeyword}放进真实购物语境，而不是只重复商品卖点。`
      ]),
      section(`${angle.primaryKeyword}真正要看的细节`, "decision-detail", [
        `比较材质、尺寸、兼容性、手感或维护成本这些会影响长期使用的因素。`,
        `用${angle.anchorLabel}作为例子，把抽象卖点翻译成读者能检查的条件。`
      ]),
      section(`哪些场景适合${angle.anchorLabel}`, "usage-fit", [
        "区分日常、通勤、礼物、自用或搭配场景，让读者知道自己是否匹配。",
        "自然插入相关商品、系列或文章内链，而不是硬塞链接。"
      ]),
      section(`下单前的反向检查`, "purchase-check", [
        "提醒读者哪些情况可能不适合，减少不必要的退换和误解。",
        "用简短清单收束，让搜索用户能快速做决定。"
      ])
    ];
  }

  return [
    section(firstSectionHeading(angle), "evidence-angle", [
      angle.trendTitle
        ? `Explain how “${angle.trendTitle}” connects to actual ${angle.category} demand.`
        : `Start with the concrete problem ${angle.anchorLabel} is meant to solve.`,
      `Keep ${angle.primaryKeyword} grounded in a shopper scenario rather than repeating product claims.`
    ]),
    section(`The ${angle.primaryKeyword} details that change the decision`, "decision-detail", [
      "Compare material, size, compatibility, feel, care, or long-term use cost where relevant.",
      `Use ${angle.anchorLabel} as the working example so abstract benefits become checkable details.`
    ]),
    section(`Where ${angle.anchorLabel} fits best`, "usage-fit", [
      "Separate daily use, commuting, gifting, styling, or replacement scenarios so readers can self-qualify.",
      "Add related products, collections, or articles only where they help the decision."
    ]),
    section(`A quick no-regret check before buying`, "purchase-check", [
      "Name the edge cases where this product or category may not be the right fit.",
      "Close with a compact checklist that helps search visitors move forward confidently."
    ])
  ];
}

function firstSectionHeading(angle: DraftAngle): string {
  if (angle.locale === "zh-CN") {
    return angle.trendTitle ? `这个趋势为什么会影响${angle.primaryKeyword}` : `${angle.anchorLabel}先解决什么问题`;
  }

  return angle.trendTitle ? `Why this trend matters for ${angle.primaryKeyword}` : `What ${angle.anchorLabel} solves first`;
}

function resolveTopic(input: NormalizedContentPipelineInput, context: ContentSourceContext): string {
  return firstNonBlank(input.topic, context.topic, context.product?.title, context.collection?.title) ?? "Shopify blog topic";
}

function cleanKeyword(keyword: string | null | undefined): string {
  return keyword?.trim().replace(/\s+/g, " ") ?? "";
}

function firstNonBlank(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
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
  const facts = productFactLines(context).slice(0, 12);
  return [
    `Product context: ${context.product.title}; vendor ${context.product.vendor ?? "unknown"}; type ${context.product.productType ?? "unknown"}.`,
    facts.length
      ? `Verified product facts to use: ${facts.join(" | ")}. Mark missing specs as unknown instead of guessing.`
      : "Verified product facts are limited; mark missing specs as unknown instead of guessing."
  ].join(" ");
}

function trendContextLine(context: ContentSourceContext): string {
  const signals = usableTrendSignals(context).slice(0, 5);
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
  const links = dedupeInternalLinks(context.internalLinks ?? []).slice(0, context.generationConfig?.internalLinks?.maxLinks ?? 4);
  if (links.length === 0) return "";

  return [
    "Use these internal links only where they help the reader. Do not create a duplicate related-links block if one already exists:",
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
  return usableTrendSignals(context)
    .flatMap((signal) => tokenizeSignal(signal.title))
    .filter((token) => token.length >= 3)
    .slice(0, 12);
}

function trendLongTailKeywords(primaryKeyword: string, context: ContentSourceContext, locale: SupportedLocale): string[] {
  const signals = usableTrendSignals(context).slice(0, 3);
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
      snippet: [context.product.vendor, context.product.tags.slice(0, 4).join(", "), ...productFactLines(context).slice(0, 4)]
        .filter(Boolean)
        .join(" · "),
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

  for (const signal of usableTrendSignals(context).slice(0, 6)) {
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

  for (const link of dedupeInternalLinks(context.internalLinks ?? []).slice(0, 4)) {
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
    firstNonBlank(
      input.primaryKeyword,
      context.seedKeywords?.[0],
      context.product?.productType,
      context.product?.title,
      context.collection?.title,
      context.topic,
      input.topic
    ) ?? "Shopify blog topic"
  );
  const category = cleanKeyword(firstNonBlank(context.product?.productType, context.collection?.title, keyword) ?? keyword);
  const usedTopics = topicHistoryValues(context);
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

  const trendCandidates = context.generationConfig?.topicDiscovery?.preferTrendSignals === false ? [] : usableTrendSignals(context);
  for (const signal of trendCandidates.slice(0, maxCandidates)) {
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

  candidates.push(...evergreenTopicCandidates(keyword, category, locale, context, evidence));

  const sorted = uniqueTopicCandidates(candidates)
    .filter((candidate) => candidate.score >= (context.generationConfig?.topicDiscovery?.minEvidenceScore ?? 0))
    .sort((a, b) => b.score - a.score);
  const novel = sorted.filter((candidate) => !isRepeatedTopic(candidate.topic, usedTopics));
  const visibleCandidates = novel.slice(0, maxCandidates);
  const selected = visibleCandidates[0] ?? fallbackNovelTopic(input.topic, keyword, category, locale, usedTopics, evidence);

  return {
    selected,
    candidates: visibleCandidates.length ? visibleCandidates : [selected]
  };
}

function evergreenTopicCandidates(
  keyword: string,
  category: string,
  locale: SupportedLocale,
  context: ContentSourceContext,
  evidence: KeywordEvidenceItem[]
): TopicCandidate[] {
  const baseScore = context.product || context.collection ? 74 : 62;
  const productTitle = context.product?.title;
  const collectionTitle = context.collection?.title;
  const anchor = firstNonBlank(productTitle, collectionTitle, keyword) ?? keyword;
  const anchorLabel = sameMeaningText(anchor, keyword) ? (locale === "zh-CN" ? "这款产品" : "this product") : anchor;
  const categoryLabel = sameMeaningText(category, keyword) ? (locale === "zh-CN" ? "同类商品" : "similar options") : category;
  const nonTrendEvidence = evidence.filter((item) => item.type !== "trend").slice(0, 6);

  const variants =
    locale === "zh-CN"
      ? [
          `${keyword}购买前怎么选：场景、材质与搭配指南`,
          `${keyword}适合谁：从${anchorLabel}看真实使用场景`,
          `${keyword}搭配灵感：通勤、礼物和日常风格怎么选`,
          `${keyword}和其他${categoryLabel}怎么比：保护、手感与外观差异`,
          `${keyword}下单前检查清单：兼容性、维护和长期使用`,
          `${categoryLabel}选购误区：什么时候${keyword}不是最佳选择`,
          `${keyword}礼物选题：如何匹配风格、保护和个性`,
          `${anchorLabel}细节拆解：哪些设计会影响长期体验`
        ]
      : [
          `How to choose ${keyword}: use cases, materials, and pairing ideas`,
          `${keyword}: who ${anchorLabel} is really for`,
          `${keyword} styling ideas for commuting, gifting, and everyday outfits`,
          `${keyword} vs. other ${categoryLabel}: protection, feel, and design differences`,
          `${keyword} pre-purchase checklist: compatibility, care, and daily use`,
          `${categoryLabel} buying mistakes: when ${keyword} may not be the best fit`,
          `${keyword} gift ideas: matching style, protection, and personality`,
          `${anchorLabel} detail review: what shoppers should notice before buying`
        ];

  return variants.map((topic, index) => ({
    topic,
    primaryKeyword: keyword,
    score: Math.max(50, baseScore - index),
    reasons: [
      index === 0 ? "stable product/category evergreen topic" : "fresh non-repeating evergreen angle",
      "built from Shopify catalog context"
    ],
    evidence: index % 2 === 0 ? nonTrendEvidence : evidence.slice(0, 6)
  }));
}

function fallbackNovelTopic(
  inputTopic: string | undefined,
  keyword: string,
  category: string,
  locale: SupportedLocale,
  usedTopics: string[],
  evidence: KeywordEvidenceItem[]
): TopicCandidate {
  const categoryLabel = sameMeaningText(category, keyword) ? (locale === "zh-CN" ? "同类商品" : "similar options") : category;
  const scenarios =
    locale === "zh-CN"
      ? ["通勤场景", "礼物场景", "旅行场景", "学生日常", "办公桌面", "周末出行", "极简搭配", "街头穿搭"]
      : ["daily commutes", "gift shoppers", "travel days", "student routines", "desk setups", "weekend plans", "minimalist outfits", "streetwear looks"];

  for (const scenario of scenarios) {
    const topic =
      locale === "zh-CN"
        ? `${keyword}在${scenario}里怎么选：${categoryLabel}的细节、风险和搭配`
        : `${keyword} for ${scenario}: ${categoryLabel} details, tradeoffs, and styling checks`;
    if (!isRepeatedTopic(topic, usedTopics)) {
      return {
        topic,
        primaryKeyword: keyword,
        score: 52,
        reasons: ["fallback fresh scenario angle", "avoids recently used topics"],
        evidence: evidence.slice(0, 6)
      };
    }
  }

  return {
    topic: inputTopic ?? (locale === "zh-CN" ? `${keyword}新选题：${categoryLabel}使用场景拆解` : `${keyword} fresh angle: ${categoryLabel} use-case breakdown`),
    primaryKeyword: keyword,
    score: 50,
    reasons: ["fallback topic"],
    evidence: evidence.slice(0, 6)
  };
}

function relatedLinksHtml(context: ContentSourceContext, locale: SupportedLocale): string {
  const links = dedupeInternalLinks(context.internalLinks ?? []).slice(0, context.generationConfig?.internalLinks?.maxLinks ?? 4);
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
  const trend = usableTrendSignals(context)[0]?.title;
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
    const paragraphs: Record<string, string> = {
      "evidence-angle": `${heading}不是简单追热点，而是先判断这个信号和${keywords.primaryKeyword}的真实需求是否匹配。写作时要把来源、商品语境和读者问题放在同一段逻辑里。`,
      "decision-detail": `读者真正需要的是可检查的细节。围绕${keywords.primaryKeyword}展开时，材质、尺寸、兼容性、维护成本和使用频率都比空泛卖点更有帮助。`,
      "usage-fit": `${heading}要回答“我会不会真的用到”。可以把日常场景、人群、搭配方式和内链商品自然放在一起，让读者更快定位自己。`,
      "purchase-check": `最后一段应该帮助读者排除不适合的情况。用${keywords.primaryKeyword}做下单前检查时，语气要具体克制，避免绝对化承诺。`
    };
    return escapeHtml(paragraphs[intent] ?? `${heading}需要把${keywords.primaryKeyword}和具体购买场景连接起来，让内容更像编辑判断，而不是固定模板。`);
  }

  const paragraphs: Record<string, string> = {
    "evidence-angle": `${heading} should treat the signal as an editorial lead, then test whether it actually matters for ${keywords.primaryKeyword}. The useful move is connecting source context, product reality, and shopper questions.`,
    "decision-detail": `Readers need details they can check. For ${keywords.primaryKeyword}, material, size, compatibility, upkeep, and frequency of use usually say more than broad benefit claims.`,
    "usage-fit": `${heading} should answer whether the reader will actually use it. Daily routines, recipient type, styling choices, and related links can make the recommendation feel specific.`,
    "purchase-check": `The closing check should rule out poor fits as clearly as it supports good ones. Keep ${keywords.primaryKeyword} advice concrete and avoid absolute promises.`
  };
  return escapeHtml(paragraphs[intent] ?? `${heading} should connect ${keywords.primaryKeyword} with a concrete shopper situation instead of repeating a fixed article template.`);
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

function topicHistoryValues(context: ContentSourceContext): string[] {
  return unique([
    ...(context.recentTopics ?? []).flatMap((item) => [item.topic, item.title]),
    ...(context.competitorTitles ?? [])
  ]);
}

function usableTrendSignals(context: ContentSourceContext) {
  const hasCatalogAnchor = Boolean(context.product || context.collection || context.seedKeywords?.length);
  const seen = new Set<string>();
  const output: NonNullable<ContentSourceContext["trendSignals"]> = [];

  for (const signal of context.trendSignals ?? []) {
    const relevance = signal.relevanceScore;
    if (hasCatalogAnchor && typeof relevance === "number" && relevance <= 0) continue;
    const key = (signal.url || signal.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(signal);
  }

  return output;
}

function dedupeInternalLinks(links: NonNullable<ContentSourceContext["internalLinks"]>) {
  const seen = new Set<string>();
  const output: NonNullable<ContentSourceContext["internalLinks"]> = [];

  for (const link of links) {
    const key = normalizeLinkUrl(link.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(link);
  }

  return output;
}

function normalizeLinkUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/g, "")}`;
  } catch {
    return value.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/g, "");
  }
}

function productFactLines(context: ContentSourceContext): string[] {
  const product = context.product;
  if (!product) return [];

  const optionFacts = (product.options ?? [])
    .map((option) => {
      const values = unique(option.values ?? []).slice(0, 8);
      if (!option.name || values.length === 0) return undefined;
      return `${option.name}: ${values.join(", ")}`;
    })
    .filter((item): item is string => Boolean(item));
  const variantTitles = unique(
    (product.variants ?? [])
      .map((variant) => variant.title)
      .filter((title) => title && title.toLowerCase() !== "default title")
  ).slice(0, 6);
  const prices = unique((product.variants ?? []).map((variant) => variant.price)).slice(0, 4);
  const skuCount = unique((product.variants ?? []).map((variant) => variant.sku)).length;
  const variantCount = product.variants?.length ?? 0;
  const availability =
    product.variants?.some((variant) => variant.availableForSale === true) === true
      ? "At least one variant is available for sale"
      : variantCount > 0 && product.variants?.every((variant) => variant.availableForSale === false) === true
        ? "All synced variants are unavailable for sale"
        : undefined;

  return unique([
    product.seoDescription ? `SEO description: ${product.seoDescription}` : undefined,
    product.productType ? `Product type: ${product.productType}` : undefined,
    product.vendor ? `Vendor: ${product.vendor}` : undefined,
    product.tags.length ? `Tags: ${product.tags.slice(0, 8).join(", ")}` : undefined,
    product.imageUrls.length ? `${product.imageUrls.length} synced product image(s)` : undefined,
    ...optionFacts,
    variantTitles.length ? `Variant titles: ${variantTitles.join(", ")}` : undefined,
    prices.length ? `Synced variant price values: ${prices.join(", ")}` : undefined,
    skuCount > 0 ? `${skuCount} synced SKU value(s)` : undefined,
    availability,
    ...(product.facts ?? [])
  ]).map((fact) => fact.slice(0, 220));
}

function isRepeatedTopic(topic: string, usedTopics: string[]): boolean {
  const candidate = topicFingerprint(topic);
  if (!candidate.normalized) return false;

  return usedTopics.some((used) => {
    const historical = topicFingerprint(used);
    if (!historical.normalized) return false;
    if (candidate.normalized === historical.normalized) return true;
    if (candidate.normalized.includes(historical.normalized) || historical.normalized.includes(candidate.normalized)) return true;
    return tokenSimilarity(candidate.tokens, historical.tokens) >= 0.78;
  });
}

function sameMeaningText(left: string, right: string): boolean {
  const leftFingerprint = topicFingerprint(left);
  const rightFingerprint = topicFingerprint(right);
  return Boolean(leftFingerprint.normalized && leftFingerprint.normalized === rightFingerprint.normalized);
}

function topicFingerprint(value: string): { normalized: string; tokens: string[] } {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordTokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !topicStopWords.has(token));
  const cjkChars = normalized.match(/[\u3400-\u9fff]/g) ?? [];
  const cjkTokens = cjkChars.length >= 4 ? cjkChars.slice(0, 60) : [];
  return {
    normalized,
    tokens: unique([...wordTokens, ...cjkTokens])
  };
}

function tokenSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

const topicStopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "your",
  "you",
  "how",
  "what",
  "why",
  "when",
  "who",
  "use",
  "uses",
  "using",
  "choose",
  "guide",
  "ideas",
  "tips",
  "faq",
  "faqs",
  "check",
  "checks",
  "before",
  "buy",
  "buying",
  "选题",
  "指南",
  "怎么",
  "如何",
  "购买",
  "选购",
  "使用",
  "建议",
  "常见问题"
]);

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
