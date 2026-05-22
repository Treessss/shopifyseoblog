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
  TopicAgentTrace,
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
  selectedTopic?: string;
  topicAgent?: TopicAgentTrace;
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
        context.seedKeywords?.[0],
        searchKeywordFromCatalog(context, locale),
        context.topicSelection?.selected.primaryKeyword,
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
    const externalReferences = externalReferenceInstruction(context, keywords, input.locale);
    const imageBrief = imagePromptInstruction(context);
    const memoryGuidance = memoryGuidanceInstruction(context);

    const system = [
      `Write in ${language}.`,
      "You are a Shopify shopping-guide editor: keep the SEO structure, but make the article read like a real buyer-friendly recommendation guide.",
      "Use evidence carefully: trend and news signals are angle inputs, not permission to fabricate facts.",
      "Never expose internal SEO, scoring, prompt, template, or search-intent labels in the reader-facing copy.",
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
        memoryGuidance,
        `Target length: ${input.targetWordCount} words.`,
        "Return title, summary, H2 sections, shopper intent, FAQs, and image alt text."
      ]
        .filter(Boolean)
        .join("\n"),
      draftPrompt: [
        `Draft the article in ${language} using the approved outline.`,
        `Primary keyword must appear naturally in title, opening paragraph, at least one H2, and conclusion: ${keywords.primaryKeyword}.`,
        "Use concise HTML-ready paragraphs, no markdown fences, no fabricated discounts or medical claims.",
        "Keep the SEO skeleton, but write like a shopping inspiration guide: real routines, gifting moments, outfit/desk/travel scenarios, and practical hesitations a buyer would recognize.",
        "Vary paragraph rhythm and examples. Avoid generic filler, repetitive sentence starts, obvious template phrasing, and meta phrases such as 'this article will', 'search intent', 'SEO', or 'content strategy'.",
        productContextLine(context),
        trendContext,
        internalLinks,
        externalReferences,
        memoryGuidance,
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
      searchIntentCoverageHtml(input, context, keywords),
      sections,
      verifiedFactsHtml(context, input.locale),
      decisionMatrixHtml(context, keywords, input.locale),
      relatedLinksHtml(context, input.locale),
      externalCitationsHtml(context, keywords, input.locale),
      faqHtml(keywords, context, input.locale),
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
    const titlePrimaryPassed = title.includes(primary) || keywordTokenCoverage(article.title, keywords.primaryKeyword) >= 0.58;

    const targetDepth = Math.max(360, Math.floor(input.targetWordCount * 0.45));
    const hasDecisionSupport = /<table\b/i.test(article.bodyHtml) || /choose|skip|适合|不适合|对比|比较|faq|常见问题/i.test(bodyText);
    const hasEvidenceSupport = /verified|confirmed|not confirmed|facts|已确认|未确认|事实|规格/i.test(bodyText);
    const contextualLinks = countMatches(article.bodyHtml, /<a\b/gi);
    const externalCitations = countExternalCitationLinks(article.bodyHtml);
    const searchIntentCoverage = hasSearchIntentCoverage(article.bodyHtml, bodyText, input.locale);
    const checks: SeoCheck[] = [
      check("title-primary", "Primary keyword in title", titlePrimaryPassed, 16),
      check("summary-primary", "Primary keyword in summary", summary.includes(primary), 10),
      check("body-primary", "Primary keyword in body", body.includes(primary), 14),
      check("heading-depth", "At least three H2 sections", headingCount >= 3, 10),
      check("target-depth", "Draft has useful depth", wordCount >= targetDepth, 16),
      check("decision-support", "Article helps the shopper make a decision", hasDecisionSupport, 12),
      check("evidence-support", "Article separates facts from unknowns", hasEvidenceSupport, 10),
      check("title-length", "Title is scannable", article.title.length >= 8 && article.title.length <= 72, 6),
      check("secondary-coverage", "Secondary keyword coverage", secondaryHits >= Math.min(2, keywords.secondaryKeywords.length), 8),
      check("internal-context", "Contextual internal links are present when available", contextualLinks > 0 || input.sourceType === "manual_topic", 4),
      check("external-citations", "External cited sources are present", externalCitations > 0, 6),
      check("search-intent-map", "Article covers the main search-intent stages", searchIntentCoverage, 6),
      check("html-structure", "HTML has semantic sections", article.bodyHtml.includes("<section>") && article.bodyHtml.includes("</section>"), 4)
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
    const minSeoScore = qualityConfig?.minSeoScore ?? 78;
    const wordCount = estimateWordCount(stripHtml(article.bodyHtml), input.locale);
    const minWords = Math.max(360, Math.floor(input.targetWordCount * 0.45));
    const body = stripHtml(article.bodyHtml).toLowerCase();
    const bannedWords = context.brandVoice?.bannedWords ?? [];
    const blockedWords = bannedWords.filter((word) => word && body.includes(word.toLowerCase()));
    const editorial = evaluateEditorialQuality(article, input.locale);
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (seo.score < minSeoScore) reasons.push(`SEO score ${seo.score} is below ${minSeoScore}.`);
    if (wordCount < minWords) reasons.push(`Estimated word count ${wordCount} is below ${minWords}.`);
    if (blockedWords.length > 0) reasons.push(`Banned words found: ${blockedWords.join(", ")}.`);
    const minEditorialScore = qualityConfig?.minEditorialScore ?? 72;
    if (qualityConfig?.enabled !== false && editorial.score < minEditorialScore) {
      reasons.push(`Editorial quality score ${editorial.score} is below ${minEditorialScore}.`);
    }
    if (qualityConfig?.requireTrendEvidence && !context.trendSignals?.length) {
      const hasEvergreenEvidence = Boolean(
        context.product ||
          context.collection ||
          context.keywordEvidence?.some((item) => item.type === "product" || item.type === "collection")
      );
      if (hasEvergreenEvidence) {
        warnings.push("No relevant trend/news signals were found; evergreen product/category evidence was used instead.");
      } else {
        reasons.push("Trend evidence was required but no relevant trend/news signals were found.");
      }
    }
    if (qualityConfig?.rejectTemplatePatterns !== false && editorial.signals.some((signal) => signal.includes("template"))) {
      reasons.push("Template-like writing patterns were detected.");
    }
    if (!article.summary) reasons.push("Missing article summary.");
    if (!article.imageAlt) warnings.push("Missing image alt text.");
    if (context.generationConfig?.internalLinks?.enabled && !article.bodyHtml.includes("<a ")) {
      warnings.push("Internal links were requested but no anchor tag was found.");
    }
    const externalConfig = context.generationConfig?.externalReferences;
    const externalRequired = Boolean(externalConfig) && externalConfig?.enabled !== false && externalConfig?.requireEveryArticle !== false;
    const minExternalLinks = externalConfig?.minLinks ?? 1;
    const externalLinks = countExternalCitationLinks(article.bodyHtml);
    if (externalRequired && externalLinks < minExternalLinks) {
      reasons.push(`External citations ${externalLinks} are below ${minExternalLinks}.`);
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
        ? `如果你正在为通勤、送礼、日常搭配或换新场景挑${angle.primaryKeyword}，先别只看第一眼好不好看。把${angle.anchorLabel}放到真实使用里看，才能判断${angle.topic}到底适不适合你。`
        : `If you're considering ${angle.primaryKeyword} for daily use, gifting, travel, or a style refresh, the first look is only part of the decision. Looking at ${angle.anchorLabel} in real-life use makes ${angle.topic} easier to judge.`,
    sections,
    conclusion:
      locale === "zh-CN"
        ? `选${angle.primaryKeyword}时，最稳的顺序是先想清楚自己的使用场景，再回到商品页确认细节。这样你不会只被图片带着走，也更容易挑到真正会常用的款。`
        : `The easiest way to choose ${angle.primaryKeyword} is to start with your real use case, then confirm the details on the product page. That keeps the decision grounded in how you'll actually use it.`,
    tags: [keywords.primaryKeyword, ...keywords.secondaryKeywords.slice(0, 4)],
    imagePrompt: buildDetailedImagePrompt(input, context, keywords),
    imageAlt: locale === "zh-CN" ? `${keywords.primaryKeyword}真实使用场景` : `${keywords.primaryKeyword} real-life shopping scene`
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

  const informationGain = informationGainSignals(article, text, locale);
  if (informationGain.length < 3) {
    score -= 16;
    signals.push(`low information gain: ${informationGain.join(", ") || "no strong source-specific signals"}`);
    recommendations.push("Add verified product facts, comparison tables, caveats, contextual links, or concrete shopper scenarios.");
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
  const topicAgent = context.topicSelection?.selected.agent;
  const productTitle = context.product?.title;
  const collectionTitle = context.collection?.title;
  const category = firstNonBlank(context.product?.productType, collectionTitle, keywords.primaryKeyword) ?? keywords.primaryKeyword;
  const trendTitle = topicAgent?.trendConcept ?? usableTrendSignals(context)[0]?.title;
  const anchorLabel = firstNonBlank(productTitle, collectionTitle, category) ?? category;
  const themes: DraftAngle["theme"][] = topicAgent
    ? [themeFromTopicAgent(topicAgent.angleKey)]
    : trendTitle
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
    selectedTopic: context.topicSelection?.selected.topic,
    topicAgent,
    theme
  };
}

function buildEditorialTitle(locale: SupportedLocale, angle: DraftAngle): string {
  const selectedTopicTitle = titleFromSelectedTopic(angle);
  if (selectedTopicTitle) return selectedTopicTitle;

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

function themeFromTopicAgent(angleKey: string): DraftAngle["theme"] {
  if (angleKey.includes("comparison")) return "comparison";
  if (angleKey.includes("mistake") || angleKey.includes("care")) return "care";
  if (angleKey.includes("question") || angleKey.includes("faq")) return "faq";
  if (angleKey.includes("trend")) return "trend";
  return "product_fit";
}

function titleFromSelectedTopic(angle: DraftAngle): string | undefined {
  const selected = angle.selectedTopic?.trim();
  if (!selected) return undefined;
  const title = selected
    .replace(/^Shopify blog topic\s*[:：-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return undefined;
  if (angle.locale !== "zh-CN" && title.length > 72) return undefined;
  if (angle.locale === "zh-CN" && title.length > 42) return undefined;
  const primaryCoverage = keywordTokenCoverage(title, angle.primaryKeyword);
  if (title.toLowerCase().includes(angle.primaryKeyword.toLowerCase()) || primaryCoverage >= 0.58) return title;
  return undefined;
}

function buildEditorialSummary(locale: SupportedLocale, angle: DraftAngle): string {
  if (locale === "zh-CN") {
    return [
      `围绕${angle.primaryKeyword}，从${angle.anchorLabel}、${angle.category}和真实买家场景判断适不适合入手。`,
      angle.trendTitle ? `参考「${angle.trendTitle}」这类热点信号，但不把热点当成商品承诺。` : "",
      "快速看清适用场景、细节风险和下单前要核对的地方。"
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
        angle.trendTitle ? `先聊「${angle.trendTitle}」为什么会让买家重新注意${angle.category}。` : `先说明${angle.anchorLabel}在日常使用里解决的具体小麻烦。`,
        `把${angle.primaryKeyword}放进通勤、送礼、搭配或桌面使用场景，而不是只堆商品卖点。`
      ]),
      section(`${angle.primaryKeyword}真正要看的细节`, "decision-detail", [
        `比较材质、尺寸、兼容性、手感或维护成本这些会影响长期使用的因素。`,
        `用${angle.anchorLabel}作为例子，把抽象卖点翻译成下单前能核对的细节。`
      ]),
      section(`哪些场景适合${angle.anchorLabel}`, "usage-fit", [
        "区分日常、通勤、礼物、自用或搭配场景，让读者知道自己是不是会真的常用。",
        "相关商品、系列或文章只在能帮读者继续挑选时出现。"
      ]),
      section(`下单前的反向检查`, "purchase-check", [
        "提醒读者哪些情况可能先别冲，减少不必要的退换和误解。",
        "用简短清单收束，让读者能更快决定要不要继续看商品页。"
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

function searchKeywordFromCatalog(context: ContentSourceContext, locale: SupportedLocale): string | undefined {
  if (locale === "zh-CN") return firstNonBlank(context.product?.productType, context.collection?.title);
  const product = context.product;
  if (!product) return context.collection?.title;

  const text = [product.title, product.productType, product.seoTitle, product.seoDescription, product.tags.join(" ")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const productType = product.productType?.trim();
  const isPhoneCase = /\b(?:phone|iphone|pixel|samsung)\b.*\bcase\b|\bcase\b.*\b(?:phone|iphone|pixel|samsung)\b/.test(text);
  if (!isPhoneCase) return firstNonBlank(productType, product.title);

  const colors = orderedMatches(text, [
    "pink",
    "green",
    "black",
    "white",
    "clear",
    "blue",
    "purple",
    "red",
    "orange",
    "yellow",
    "brown",
    "cream",
    "silver",
    "gold"
  ]).slice(0, 2);
  const styles = orderedMatches(text, [
    "floral",
    "flower",
    "tropical leaf",
    "leaf",
    "cartoon",
    "kawaii",
    "lace",
    "polka dot",
    "heart",
    "cross",
    "streetwear",
    "magsafe",
    "matte",
    "glossy",
    "clear",
    "shockproof"
  ]).slice(0, 2);
  const colorPhrase = colors.length === 2 ? `${colors[0]} and ${colors[1]}` : colors[0];
  const descriptor = unique([colorPhrase, ...styles])
    .filter((value) => value && value !== "flower")
    .join(" ");
  const device = /\biphone\b/.test(text) ? "iPhone" : "phone";
  const keyword = cleanKeyword(`${descriptor ? `${descriptor} ` : ""}${device} case`);
  return keyword.length > `${device} case`.length ? keyword : firstNonBlank(productType, product.title);
}

function orderedMatches(value: string, phrases: string[]): string[] {
  const matches = phrases
    .map((phrase) => ({ phrase, index: value.indexOf(phrase) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.phrase);
  return matches.filter((phrase, index) => !matches.slice(0, index).some((existing) => existing.includes(phrase)));
}

function keywordTokenCoverage(title: string, keyword: string): number {
  const titleTokens = new Set(keywordTokens(title));
  const keywordTokensValue = keywordTokens(keyword);
  if (keywordTokensValue.length === 0) return 0;
  const hits = keywordTokensValue.filter((token) => titleTokens.has(token)).length;
  return hits / keywordTokensValue.length;
}

function keywordTokens(value: string): string[] {
  return unique(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !keywordStopWords.has(token))
  );
}

const keywordStopWords = new Set(["the", "and", "for", "with", "from", "design", "pattern", "style", "caseease"]);

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

function externalReferenceInstruction(context: ContentSourceContext, keywords: KeywordPlan, locale: SupportedLocale): string {
  if (context.generationConfig?.externalReferences?.enabled === false) return "";
  const references = externalCitationCandidates(context, keywords, locale);
  if (references.length === 0) return "";

  const minLinks = context.generationConfig?.externalReferences?.minLinks ?? 1;
  return [
    `Use at least ${minLinks} cited external reference link(s), only from this approved list. Do not invent citation URLs:`,
    ...references.map((reference) =>
      `- ${reference.title} (${reference.source}): ${reference.url}${reference.reason ? ` — ${reference.reason}` : ""}`
    ),
    "Citations must support search intent, trend context, or factual background. Place them in natural sentences and keep the final reference section."
  ].join("\n");
}

function memoryGuidanceInstruction(context: ContentSourceContext): string {
  const guidance = context.memoryStrategy?.guidance.slice(0, 5) ?? [];
  if (guidance.length === 0) return "";

  return [
    "Private performance guidance to follow; do not mention these constraints in the article:",
    ...guidance.map((item) => `- ${item.instruction}`)
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

  for (const reference of externalCitationCandidates(context, { primaryKeyword: input.primaryKeyword ?? input.topic ?? "" }, DEFAULT_LOCALE).slice(0, 4)) {
    evidence.push({
      type: "external_reference",
      source: reference.source,
      label: "External citation candidate",
      value: reference.title,
      url: reference.url,
      snippet: reference.snippet ?? reference.reason,
      publishedAt: reference.publishedAt,
      relevanceScore: reference.relevanceScore,
      metric: "approved external reference",
      confidence: clampScore(66 + (reference.relevanceScore ?? 0) * 4)
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
      searchKeywordFromCatalog(context, locale),
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
      evidence: evidence.slice(0, 6),
      agent: topicAgentTrace("manual_topic", "BOFU", "commercial", 82, 88, 80)
    });
  }

  candidates.push(...topicAgentTrendCandidates(keyword, category, locale, context, evidence, usedTopics));

  candidates.push(...evergreenTopicCandidates(keyword, category, locale, context, evidence, usedTopics));

  const sorted = uniqueTopicCandidates(candidates)
    .map((candidate) => applyTopicHistoryPenalty(candidate, usedTopics, context))
    .filter((candidate) => candidate.score >= (context.generationConfig?.topicDiscovery?.minEvidenceScore ?? 0))
    .sort((a, b) => b.score - a.score);
  const novel = sorted.filter((candidate) => !isRepeatedTopic(candidate.topic, usedTopics));
  const visibleCandidates = diverseTopicCandidates(novel, maxCandidates);
  const selected = visibleCandidates[0] ?? fallbackNovelTopic(input.topic, keyword, category, locale, usedTopics, evidence);

  return {
    selected,
    candidates: visibleCandidates.length ? visibleCandidates : [selected]
  };
}

type TopicAngleContext = {
  keyword: string;
  categoryLabel: string;
  trendConcept: string;
  scenario: string;
};

type TopicAngleDefinition = {
  key: string;
  funnelStage: TopicAgentTrace["funnelStage"];
  searchIntent: TopicAgentTrace["searchIntent"];
  impactBoost: number;
  confidenceBoost: number;
  reason: string;
  topic: (context: TopicAngleContext) => string;
};

function topicAgentTrendCandidates(
  keyword: string,
  category: string,
  locale: SupportedLocale,
  context: ContentSourceContext,
  evidence: KeywordEvidenceItem[],
  usedTopics: string[]
): TopicCandidate[] {
  if (context.generationConfig?.topicDiscovery?.preferTrendSignals === false) return [];

  const signals = usableTrendSignals(context).slice(0, 6);
  if (signals.length === 0) return [];

  const scenarios = shopperScenarios(context, locale);
  const categoryLabel = sameMeaningText(category, keyword) ? (locale === "zh-CN" ? "同类商品" : "similar options") : category;
  const nonTrendEvidence = evidence.filter((item) => item.type !== "trend").slice(0, 4);
  const angles = trendExpansionAngles(locale);
  const candidates: TopicCandidate[] = [];

  for (const signal of signals) {
    const trendConcept = compactTrendConcept(signal, locale);
    const signalEvidence = evidence.filter((item) => item.type === "trend" && item.value === signal.title);
    const trendImpact = clampScore(72 + (signal.relevanceScore ?? 0) * 4 + trafficBoost(signal.traffic));
    const trendConfidence = clampScore(62 + (signal.relevanceScore ?? 0) * 5 + trafficBoost(signal.traffic));

    for (const angle of angles) {
      const scenario = scenarios[Math.abs(hashString(`${trendConcept}:${angle.key}:${keyword}`)) % scenarios.length] ?? scenarios[0];
      const topic = angle.topic({ keyword, categoryLabel, trendConcept, scenario });
      const noveltyScore = topicNoveltyScore(topic, usedTopics, angle.key);
      const impact = clampScore(trendImpact + angle.impactBoost);
      const confidence = clampScore(trendConfidence + angle.confidenceBoost);

      candidates.push({
        topic,
        primaryKeyword: keyword,
        score: agentOpportunityScore(impact, confidence, noveltyScore, signal.traffic),
        reasons: [
          `SEO Topic Agent: ${angle.reason}`,
          "expanded from Google Trends/news evidence",
          signal.traffic ? `trend traffic ${signal.traffic}` : "RSS trend signal",
          noveltyScore >= 78 ? "high topic novelty against recent history" : "topic history considered"
        ],
        evidence: [...signalEvidence, ...nonTrendEvidence],
        agent: topicAgentTrace(angle.key, angle.funnelStage, angle.searchIntent, impact, confidence, noveltyScore, trendConcept)
      });
    }
  }

  return candidates;
}

function trendExpansionAngles(locale: SupportedLocale): TopicAngleDefinition[] {
  if (locale === "zh-CN") {
    return [
      {
        key: "trend_bridge",
        funnelStage: "TOFU",
        searchIntent: "informational",
        impactBoost: 3,
        confidenceBoost: 0,
        reason: "trend-to-category bridge",
        topic: ({ keyword, trendConcept }) => `${trendConcept}之后，${keyword}该怎么选？`
      },
      {
        key: "scenario_fit",
        funnelStage: "MOFU",
        searchIntent: "commercial",
        impactBoost: 6,
        confidenceBoost: 3,
        reason: "shopper scenario fit",
        topic: ({ keyword, scenario }) => `${keyword}适合${scenario}吗？场景、风格和保护检查`
      },
      {
        key: "comparison_decision",
        funnelStage: "BOFU",
        searchIntent: "commercial",
        impactBoost: 8,
        confidenceBoost: 4,
        reason: "comparison decision angle",
        topic: ({ keyword, categoryLabel, scenario }) => `${keyword}还是其他${categoryLabel}？按${scenario}做选择`
      },
      {
        key: "mistake_avoidance",
        funnelStage: "BOFU",
        searchIntent: "commercial",
        impactBoost: 7,
        confidenceBoost: 5,
        reason: "purchase risk and mistake avoidance",
        topic: ({ keyword, trendConcept }) => `${keyword}购买前别只看外观：${trendConcept}带来的检查清单`
      },
      {
        key: "gift_moment",
        funnelStage: "MOFU",
        searchIntent: "commercial",
        impactBoost: 4,
        confidenceBoost: 2,
        reason: "gift and occasion expansion",
        topic: ({ keyword, trendConcept }) => `${keyword}送礼怎么选：从${trendConcept}看风格和保护`
      }
    ];
  }

  return [
    {
      key: "trend_bridge",
      funnelStage: "TOFU",
      searchIntent: "informational",
      impactBoost: 3,
      confidenceBoost: 0,
      reason: "trend-to-category bridge",
      topic: ({ keyword, trendConcept }) => `What ${trendConcept} Means for ${keyword}`
    },
    {
      key: "scenario_fit",
      funnelStage: "MOFU",
      searchIntent: "commercial",
      impactBoost: 6,
      confidenceBoost: 3,
      reason: "shopper scenario fit",
      topic: ({ keyword, scenario }) => `${keyword} for ${scenario}: Fit, Style, and Buying Checks`
    },
    {
      key: "comparison_decision",
      funnelStage: "BOFU",
      searchIntent: "commercial",
      impactBoost: 8,
      confidenceBoost: 4,
      reason: "comparison decision angle",
      topic: ({ keyword, categoryLabel, scenario }) => `${keyword} vs. Other ${categoryLabel}: What Changes for ${scenario}`
    },
    {
      key: "mistake_avoidance",
      funnelStage: "BOFU",
      searchIntent: "commercial",
      impactBoost: 7,
      confidenceBoost: 5,
      reason: "purchase risk and mistake avoidance",
      topic: ({ keyword, trendConcept }) => `Before Buying ${keyword}, Check These ${trendConcept} Details`
    },
    {
      key: "gift_moment",
      funnelStage: "MOFU",
      searchIntent: "commercial",
      impactBoost: 4,
      confidenceBoost: 2,
      reason: "gift and occasion expansion",
      topic: ({ keyword, trendConcept }) => `${keyword} Gift Ideas Inspired by ${trendConcept}`
    }
  ];
}

function evergreenTopicCandidates(
  keyword: string,
  category: string,
  locale: SupportedLocale,
  context: ContentSourceContext,
  evidence: KeywordEvidenceItem[],
  usedTopics: string[]
): TopicCandidate[] {
  const baseScore = context.product || context.collection ? 74 : 62;
  const productTitle = context.product?.title;
  const collectionTitle = context.collection?.title;
  const anchor = firstNonBlank(productTitle, collectionTitle, keyword) ?? keyword;
  const anchorLabel = sameMeaningText(anchor, keyword) ? (locale === "zh-CN" ? "这款产品" : "this product") : anchor;
  const categoryLabel = sameMeaningText(category, keyword) ? (locale === "zh-CN" ? "同类商品" : "similar options") : category;
  const nonTrendEvidence = evidence.filter((item) => item.type !== "trend").slice(0, 6);

  const variants: Array<{
    topic: string;
    angleKey: string;
    funnelStage: TopicAgentTrace["funnelStage"];
    searchIntent: TopicAgentTrace["searchIntent"];
    impactBoost: number;
    confidenceBoost: number;
  }> =
    locale === "zh-CN"
      ? [
          {
            topic: `${keyword}购买前怎么选：场景、材质与搭配指南`,
            angleKey: "evergreen_buying_guide",
            funnelStage: "MOFU",
            searchIntent: "commercial",
            impactBoost: 0,
            confidenceBoost: 6
          },
          {
            topic: `${keyword}适合谁：从${anchorLabel}看真实使用场景`,
            angleKey: "scenario_fit",
            funnelStage: "MOFU",
            searchIntent: "commercial",
            impactBoost: 2,
            confidenceBoost: 4
          },
          {
            topic: `${keyword}搭配灵感：通勤、礼物和日常风格怎么选`,
            angleKey: "style_scenario",
            funnelStage: "TOFU",
            searchIntent: "informational",
            impactBoost: 0,
            confidenceBoost: 2
          },
          {
            topic: `${keyword}和其他${categoryLabel}怎么比：保护、手感与外观差异`,
            angleKey: "comparison_decision",
            funnelStage: "BOFU",
            searchIntent: "commercial",
            impactBoost: 5,
            confidenceBoost: 5
          },
          {
            topic: `${keyword}下单前检查清单：兼容性、维护和长期使用`,
            angleKey: "mistake_avoidance",
            funnelStage: "BOFU",
            searchIntent: "commercial",
            impactBoost: 4,
            confidenceBoost: 5
          },
          {
            topic: `${categoryLabel}选购误区：什么时候${keyword}不是最佳选择`,
            angleKey: "anti_fit",
            funnelStage: "BOFU",
            searchIntent: "commercial",
            impactBoost: 3,
            confidenceBoost: 4
          },
          {
            topic: `${keyword}礼物选题：如何匹配风格、保护和个性`,
            angleKey: "gift_moment",
            funnelStage: "MOFU",
            searchIntent: "commercial",
            impactBoost: 1,
            confidenceBoost: 3
          },
          {
            topic: `${anchorLabel}细节拆解：哪些设计会影响长期体验`,
            angleKey: "detail_review",
            funnelStage: "BOFU",
            searchIntent: "commercial",
            impactBoost: 2,
            confidenceBoost: 4
          }
        ]
      : [
          {
            topic: `How to choose ${keyword}: use cases, materials, and pairing ideas`,
            angleKey: "evergreen_buying_guide",
            funnelStage: "MOFU",
            searchIntent: "commercial",
            impactBoost: 0,
            confidenceBoost: 6
          },
          {
            topic: `${keyword}: who ${anchorLabel} is really for`,
            angleKey: "scenario_fit",
            funnelStage: "MOFU",
            searchIntent: "commercial",
            impactBoost: 2,
            confidenceBoost: 4
          },
          {
            topic: `${keyword} styling ideas for commuting, gifting, and everyday outfits`,
            angleKey: "style_scenario",
            funnelStage: "TOFU",
            searchIntent: "informational",
            impactBoost: 0,
            confidenceBoost: 2
          },
          {
            topic: `${keyword} vs. other ${categoryLabel}: protection, feel, and design differences`,
            angleKey: "comparison_decision",
            funnelStage: "BOFU",
            searchIntent: "commercial",
            impactBoost: 5,
            confidenceBoost: 5
          },
          {
            topic: `${keyword} pre-purchase checklist: compatibility, care, and daily use`,
            angleKey: "mistake_avoidance",
            funnelStage: "BOFU",
            searchIntent: "commercial",
            impactBoost: 4,
            confidenceBoost: 5
          },
          {
            topic: `${categoryLabel} buying mistakes: when ${keyword} may not be the best fit`,
            angleKey: "anti_fit",
            funnelStage: "BOFU",
            searchIntent: "commercial",
            impactBoost: 3,
            confidenceBoost: 4
          },
          {
            topic: `${keyword} gift ideas: matching style, protection, and personality`,
            angleKey: "gift_moment",
            funnelStage: "MOFU",
            searchIntent: "commercial",
            impactBoost: 1,
            confidenceBoost: 3
          },
          {
            topic: `${anchorLabel} detail review: what shoppers should notice before buying`,
            angleKey: "detail_review",
            funnelStage: "BOFU",
            searchIntent: "commercial",
            impactBoost: 2,
            confidenceBoost: 4
          }
        ];

  return variants.map((variant, index) => {
    const noveltyScore = topicNoveltyScore(variant.topic, usedTopics, variant.angleKey);
    const impact = clampScore(baseScore + variant.impactBoost + (context.internalLinks?.length ? 3 : 0));
    const confidence = clampScore(72 + variant.confidenceBoost + (context.product || context.collection ? 8 : 0));

    return {
      topic: variant.topic,
      primaryKeyword: keyword,
      score: agentOpportunityScore(impact, confidence, noveltyScore),
      reasons: [
        index === 0 ? "stable product/category evergreen topic" : "fresh non-repeating evergreen angle",
        "SEO Topic Agent: built from Shopify catalog context",
        noveltyScore >= 78 ? "high topic novelty against recent history" : "topic history considered"
      ],
      evidence: index % 2 === 0 ? nonTrendEvidence : evidence.slice(0, 6),
      agent: topicAgentTrace(
        variant.angleKey,
        variant.funnelStage,
        variant.searchIntent,
        impact,
        confidence,
        noveltyScore
      )
    };
  });
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
        evidence: evidence.slice(0, 6),
        agent: topicAgentTrace("fallback_scenario", "MOFU", "commercial", 55, 68, topicNoveltyScore(topic, usedTopics, "fallback_scenario"))
      };
    }
  }

  const defaultFallback =
    inputTopic ?? (locale === "zh-CN" ? `${keyword}新选题：${categoryLabel}使用场景拆解` : `${keyword} fresh angle: ${categoryLabel} use-case breakdown`);
  const fallbackTopic = isRepeatedTopic(defaultFallback, usedTopics)
    ? uniqueFallbackTopic(keyword, categoryLabel, locale, usedTopics)
    : defaultFallback;

  return {
    topic: fallbackTopic,
    primaryKeyword: keyword,
    score: 50,
    reasons: ["fallback topic"],
    evidence: evidence.slice(0, 6),
    agent: topicAgentTrace("fallback_topic", "MOFU", "commercial", 50, 62, topicNoveltyScore(fallbackTopic, usedTopics, "fallback_topic"))
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

function searchIntentCoverageHtml(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext,
  keywords: KeywordPlan
): string {
  const locale = normalizeLocale(input.locale);
  const source = context.product?.title ?? context.collection?.title ?? keywords.primaryKeyword;
  const primaryKeyword = escapeHtml(keywords.primaryKeyword);
  if (locale === "zh-CN") {
    return `<section><h2>先帮你判断适不适合</h2><ul><li><strong>一句话结论：</strong>${primaryKeyword}先看使用场景，再看外观和细节。</li><li><strong>能确认的依据：</strong>只使用${escapeHtml(source)}中已同步的商品、系列和图片信息。</li><li><strong>下单前判断：</strong>用适合/先别冲、对比和常见问题帮你决定下一步。</li></ul></section>`;
  }

  return `<section><h2>Start here: is it a good fit?</h2><ul><li><strong>Quick take:</strong> ${primaryKeyword} should be judged by use case first, then look and details.</li><li><strong>What is confirmed:</strong> this guide uses only synced product, collection, and image context from ${escapeHtml(source)}.</li><li><strong>Before you buy:</strong> fit/skip guidance, comparison, and FAQs help you decide the next step.</li></ul></section>`;
}

function externalCitationsHtml(context: ContentSourceContext, keywords: KeywordPlan, locale: SupportedLocale): string {
  if (context.generationConfig?.externalReferences?.enabled === false) return "";
  const references = externalCitationCandidates(context, keywords, locale);
  const minLinks = context.generationConfig?.externalReferences?.minLinks ?? 1;
  if (references.length < minLinks && context.generationConfig?.externalReferences?.requireEveryArticle !== false) return "";
  if (references.length === 0) return "";

  const heading = locale === "zh-CN" ? "参考来源" : "External references";
  const note =
    locale === "zh-CN"
      ? "这些链接用于判断趋势、搜索需求或背景信息，商品细节仍以本店同步数据为准。"
      : "These links support trend, demand, or background context; product-specific details still come from synced store data.";
  const items = references
    .map((reference) => {
      const label = `${reference.title}${reference.source ? ` · ${reference.source}` : ""}`;
      const extra = reference.reason ?? reference.snippet;
      return `<li><a href="${escapeHtml(reference.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(label)}</a>${extra ? ` <span>${escapeHtml(extra)}</span>` : ""}</li>`;
    })
    .join("");
  return `<section><h2>${heading}</h2><p>${escapeHtml(note)}</p><ul>${items}</ul></section>`;
}

function verifiedFactsHtml(context: ContentSourceContext, locale: SupportedLocale): string {
  const facts = [
    context.product?.title ? [locale === "zh-CN" ? "已确认商品" : "Confirmed product", context.product.title] : undefined,
    context.product?.productType ? [locale === "zh-CN" ? "品类" : "Category", context.product.productType] : undefined,
    context.product?.vendor ? [locale === "zh-CN" ? "供应商" : "Vendor", context.product.vendor] : undefined,
    context.product?.tags?.length ? [locale === "zh-CN" ? "同步标签" : "Synced tags", context.product.tags.slice(0, 6).join(", ")] : undefined,
    context.product?.imageUrls?.length
      ? [locale === "zh-CN" ? "商品图片" : "Product images", `${context.product.imageUrls.length}`]
      : undefined,
    context.collection?.title ? [locale === "zh-CN" ? "已确认系列" : "Confirmed collection", context.collection.title] : undefined
  ].filter((item): item is string[] => Boolean(item));

  if (facts.length === 0) return "";
  const heading = locale === "zh-CN" ? "下单前能确认的细节" : "What you can confirm before buying";
  const rows = facts.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
  const unknown =
    locale === "zh-CN"
      ? "如果材质、跌落保护、适配范围或促销信息没有在商品数据里写清，先回到商品页核对，不要凭感觉下单。"
      : "Material, drop protection, compatibility scope, and promotions should stay unclaimed when they are not confirmed in synced data.";

  return `<section><h2>${heading}</h2><table><tbody>${rows}</tbody></table><p>${escapeHtml(unknown)}</p></section>`;
}

function decisionMatrixHtml(context: ContentSourceContext, keywords: KeywordPlan, locale: SupportedLocale): string {
  const heading = locale === "zh-CN" ? `适合谁，哪些情况先别冲` : `Who it fits, and when to skip`;
  const rows =
    locale === "zh-CN"
      ? [
          ["适合", "想围绕真实商品信息、图片和日常使用场景做判断的买家。"],
          ["先别冲", "如果你需要未同步的保护等级、材质认证或具体促销承诺，先查看商品页。"],
          ["下一步", context.internalLinks?.[0] ? `继续看：${context.internalLinks[0].anchor ?? context.internalLinks[0].title}` : "对照商品页里的规格、变体和图片。"]
        ]
      : [
          ["Choose this if", "You want a decision based on synced product facts, images, and realistic use cases."],
          ["Skip this if", "You need unconfirmed protection ratings, material certifications, or promotion claims before deciding."],
          ["Next step", context.internalLinks?.[0] ? `Continue with ${context.internalLinks[0].anchor ?? context.internalLinks[0].title}` : "Check the product page for specs, variants, and images."]
        ];
  const body = rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
  return `<section><h2>${escapeHtml(heading)}</h2><table><tbody>${body}</tbody></table></section>`;
}

function faqHtml(keywords: KeywordPlan, context: ContentSourceContext, locale: SupportedLocale): string {
  const heading = locale === "zh-CN" ? "常见问题" : "FAQ";
  const product = context.product?.title ?? keywords.primaryKeyword;
  const items =
    locale === "zh-CN"
      ? [
          [`${keywords.primaryKeyword}适合日常使用吗？`, `如果${product}的图片、标签和商品页信息符合你的通勤、出门或日常搭配习惯，它更适合先加入候选；未确认的保护等级不要默认假设。`],
          [`送礼会不会太挑人？`, "如果对方喜欢这个风格或已经在看同类款式，会更稳；不确定型号、颜色偏好或材质要求时，先选可核对规格的商品页。"],
          [`搭配什么场景更自然？`, "可以优先想桌面、通勤包、日常穿搭或旅行使用场景，再判断颜色、图案和功能细节是否协调。"],
          [`购买前要看哪些已确认信息？`, "先看商品标题、品类、标签、图片、变体和商品页描述，再判断材质、兼容性或维护要求是否已经明确。"],
          [`什么时候不建议只看这份建议下单？`, "当你需要精确型号、保护认证、促销价格或发货承诺时，应该回到商品页核对最新信息。"]
        ]
      : [
          [`Is ${keywords.primaryKeyword} good for daily use?`, `It can be, if ${product} matches the shopper's use case in the synced images, tags, and product-page facts. Do not assume unconfirmed protection ratings.`],
          ["What should I check before buying?", "Check the title, category, tags, images, variants, and product description before relying on material, compatibility, or care assumptions."],
          ["When should I not buy from this article alone?", "Go back to the product page when you need exact model fit, certification details, current pricing, shipping promises, or promotions."],
          ["How should the internal links help?", "Internal links should move the reader to a related product, collection, or article that helps the next decision."],
          ["Why mention not-confirmed details?", "Clear unknowns prevent inflated claims and tell search visitors exactly what to verify next."]
        ];
  return `<section><h2>${heading}</h2>${items
    .map(([question, answer]) => `<h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p>`)
    .join("")}</section>`;
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
      "evidence-angle": `${heading}不是简单追热点，而是看它会不会改变你挑${keywords.primaryKeyword}时的优先级。比如通勤、送礼、日常搭配这些场景，往往比一句卖点更能说明适不适合。`,
      "decision-detail": `真正影响使用感的通常是可检查的细节。围绕${keywords.primaryKeyword}展开时，材质、尺寸、兼容性、维护成本和使用频率都比空泛卖点更有帮助。`,
      "usage-fit": `${heading}要回答“我会不会真的用到”。可以把日常场景、人群、搭配方式和内链商品自然放在一起，让读者更快定位自己。`,
      "purchase-check": `下单前再反向看一遍，会更容易避开不适合自己的选择。用${keywords.primaryKeyword}做检查时，重点是确认需求和商品页细节，而不是被单一图片或标题带着走。`
    };
    return escapeHtml(paragraphs[intent] ?? `${heading}可以把${keywords.primaryKeyword}和具体购买场景连接起来，让读者更快判断是否适合自己。`);
  }

  const paragraphs: Record<string, string> = {
    "evidence-angle": `${heading} should treat the signal as an editorial lead, then test whether it actually matters for ${keywords.primaryKeyword}. The useful move is connecting source context, product reality, and shopper questions.`,
    "decision-detail": `Readers need details they can check. For ${keywords.primaryKeyword}, material, size, compatibility, upkeep, and frequency of use usually say more than broad benefit claims.`,
    "usage-fit": `${heading} should answer whether the reader will actually use it. Daily routines, recipient type, styling choices, and related links can make the recommendation feel specific.`,
    "purchase-check": `The closing check should rule out poor fits as clearly as it supports good ones. Keep ${keywords.primaryKeyword} advice concrete and avoid absolute promises.`
  };
  return escapeHtml(paragraphs[intent] ?? `${heading} should connect ${keywords.primaryKeyword} with a concrete shopper situation instead of repeating a fixed article template.`);
}

function informationGainSignals(article: HtmlAssemblyResult, text: string, locale: SupportedLocale): string[] {
  const signals: string[] = [];
  if (/<table\b/i.test(article.bodyHtml)) signals.push("table");
  if (/<a\b/i.test(article.bodyHtml)) signals.push("contextual link");
  if (/\d/.test(text)) signals.push("specific numbers");
  if (locale === "zh-CN") {
    if (/已确认|未确认|事实|规格|变体|价格|库存|标签/.test(text)) signals.push("verified facts");
    if (/适合|不适合|跳过|下单前|购买前|场景/.test(text)) signals.push("decision guidance");
    if (/常见问题|FAQ|[？?]/i.test(text)) signals.push("faq");
  } else {
    if (/verified|confirmed|not confirmed|not listed|specs|variant|price|stock|tag/i.test(text)) signals.push("verified facts");
    if (/choose this if|skip this if|before you buy|pre-purchase|use case|best for/i.test(text)) signals.push("decision guidance");
    if (/FAQ|question|\?/i.test(text)) signals.push("faq");
  }
  return signals;
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
    const fingerprint = topicFingerprint(item.topic).normalized || item.topic.toLowerCase();
    const key = fingerprint.toLowerCase();
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
    if (looksLikeProductListingSignal(signal.title, signal.summary)) continue;
    const key = (signal.url || signal.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(signal);
  }

  return output;
}

function externalCitationCandidates(context: ContentSourceContext, keywords: Pick<KeywordPlan, "primaryKeyword">, locale: SupportedLocale) {
  if (context.generationConfig?.externalReferences?.enabled === false) return [];
  const maxLinks = context.generationConfig?.externalReferences?.maxLinks ?? 3;
  const configured = context.externalReferences ?? [];
  const trends = usableTrendSignals(context)
    .filter((signal) => Boolean(signal.url))
    .map((signal) => ({
      title: signal.title,
      url: signal.url as string,
      source: signal.source || "trend feed",
      snippet: signal.summary,
      publishedAt: signal.publishedAt,
      reason: locale === "zh-CN" ? "用于判断当前搜索或新闻背景" : "supports current search or news context",
      relevanceScore: signal.relevanceScore
    }));
  const query = firstNonBlank(keywords.primaryKeyword, context.topic, context.product?.productType, context.collection?.title) ?? "Shopify ecommerce";
  const fallback = {
    title: locale === "zh-CN" ? `${query} 的 Google Trends 趋势` : `Google Trends for ${query}`,
    url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
    source: "Google Trends",
    reason: locale === "zh-CN" ? "用于交叉检查搜索需求变化" : "for cross-checking search demand movement",
    relevanceScore: 1
  };
  const candidates = [...configured, ...trends, fallback]
    .filter((reference) => isUsableExternalUrl(reference.url))
    .map((reference) => ({
      ...reference,
      title: reference.title?.trim() || reference.source || reference.url,
      source: reference.source?.trim() || "External source"
    }));
  return dedupeExternalReferences(candidates).slice(0, Math.max(1, maxLinks));
}

function dedupeExternalReferences(references: NonNullable<ContentSourceContext["externalReferences"]>) {
  const seen = new Set<string>();
  const output: NonNullable<ContentSourceContext["externalReferences"]> = [];
  for (const reference of references) {
    const key = normalizeExternalUrl(reference.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(reference);
  }
  return output;
}

function isUsableExternalUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.hostname.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function countExternalCitationLinks(bodyHtml: string): number {
  let citations = 0;
  const pattern = /<a\b([^>]*)\shref=["']([^"']+)["']([^>]*)>/gi;
  for (const match of bodyHtml.matchAll(pattern)) {
    const attrs = `${match[1] ?? ""} ${match[3] ?? ""}`.toLowerCase();
    const href = match[2] ?? "";
    if (!isUsableExternalUrl(href)) continue;
    if (attrs.includes("nofollow") || attrs.includes("noopener") || isLikelyExternalReferenceUrl(href)) citations += 1;
  }
  return citations;
}

function isLikelyExternalReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host.includes("myshopify.com")) return false;
    if (/\/(?:products|collections|blogs)\//.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

function hasSearchIntentCoverage(html: string, text: string, locale: SupportedLocale): boolean {
  if (/search intent coverage|搜索意图覆盖|先帮你判断适不适合|Start here: is it a good fit/i.test(html)) return true;
  const hasQuickAnswer =
    locale === "zh-CN"
      ? /(快速答案|直接答案|结论先说|一句话结论|一句话)/i.test(text)
      : /(quick answer|short answer|answer first|bottom line|quick take)/i.test(text);
  const hasFacts =
    locale === "zh-CN" ? /(已确认|未确认|事实|规格|来源|参考)/i.test(text) : /(verified|confirmed|not confirmed|facts|source|reference)/i.test(text);
  const hasDecision =
    locale === "zh-CN" ? /(适合|不适合|对比|选择|跳过|下单前)/i.test(text) : /(choose|skip|comparison|decision|before you buy|best for)/i.test(text);
  const hasFaq = /FAQ|常见问题|[?？]/i.test(text);
  return [hasQuickAnswer, hasFacts, hasDecision, hasFaq].filter(Boolean).length >= 3;
}

function looksLikeProductListingSignal(title: string, summary?: string): boolean {
  const text = `${title} ${summary ?? ""}`.toLowerCase();
  const productSpecHits = [
    "shockproof",
    "bumper",
    "protector",
    "wireless charging",
    "raised camera",
    "adhesive",
    "compatible",
    "tpu",
    "pc protection"
  ].filter((term) => text.includes(term)).length;
  const commercePattern = /\b(?:case|cover|popsocket|popgrip)\s+(?:for|with)\b/.test(text) || /\bfor\s+(?:iphone|google pixel|samsung)\b/.test(text);
  return commercePattern && productSpecHits >= 2;
}

function applyTopicHistoryPenalty(candidate: TopicCandidate, usedTopics: string[], context: ContentSourceContext): TopicCandidate {
  const maxSimilarity = maxTopicSimilarity(candidate.topic, usedTopics);
  const angleRecentlyUsed = candidate.agent ? usedTopics.some((topic) => inferredTopicAngleKey(topic) === candidate.agent?.angleKey) : false;
  const memoryPenalty = agentMemoryPenalty(candidate, context);
  const penalty = Math.round(maxSimilarity * 18) + (angleRecentlyUsed ? 8 : 0) + memoryPenalty;
  if (penalty <= 0) return candidate;

  const score = clampScore(candidate.score - penalty);
  const noveltyScore = clampScore((candidate.agent?.noveltyScore ?? 80) - penalty);

  return {
    ...candidate,
    score,
    reasons: [...candidate.reasons, memoryPenalty > 0 ? "agent memory reduced score" : "recent topic history reduced score"],
    agent: candidate.agent
      ? {
          ...candidate.agent,
          noveltyScore
        }
      : undefined
  };
}

function agentMemoryPenalty(candidate: TopicCandidate, context: ContentSourceContext): number {
  let penalty = 0;
  for (const memory of context.agentMemories ?? []) {
    const activeAvoid = memory.avoidUntil && new Date(memory.avoidUntil).getTime() > Date.now();
    if (activeAvoid && memory.angleKey && candidate.agent?.angleKey === memory.angleKey) penalty += 16;
    if (memory.outcome === "failed" && memory.keyword && keywordTokenCoverage(candidate.primaryKeyword, memory.keyword) >= 0.7) {
      penalty += 10;
    }
  }
  return Math.min(26, penalty);
}

function diverseTopicCandidates(candidates: TopicCandidate[], limit: number): TopicCandidate[] {
  const output: TopicCandidate[] = [];
  const usedAngles = new Set<string>();
  for (const candidate of candidates) {
    const angleKey = candidate.agent?.angleKey;
    if (angleKey && usedAngles.has(angleKey) && output.length < Math.min(limit, 3)) continue;
    output.push(candidate);
    if (angleKey) usedAngles.add(angleKey);
    if (output.length >= limit) break;
  }

  if (output.length >= limit) return output;
  for (const candidate of candidates) {
    if (output.includes(candidate)) continue;
    output.push(candidate);
    if (output.length >= limit) break;
  }

  return output;
}

function topicAgentTrace(
  angleKey: string,
  funnelStage: TopicAgentTrace["funnelStage"],
  searchIntent: TopicAgentTrace["searchIntent"],
  impact: number,
  confidence: number,
  noveltyScore: number,
  trendConcept?: string
): TopicAgentTrace {
  return {
    role: "seo_topic_agent",
    angleKey,
    funnelStage,
    searchIntent,
    trendConcept,
    impact: clampScore(impact),
    confidence: clampScore(confidence),
    noveltyScore: clampScore(noveltyScore)
  };
}

function agentOpportunityScore(impact: number, confidence: number, noveltyScore: number, traffic?: string): number {
  return clampScore(impact * 0.44 + confidence * 0.34 + noveltyScore * 0.22 + trafficBoost(traffic) * 0.45);
}

function topicNoveltyScore(topic: string, usedTopics: string[], angleKey?: string): number {
  const similarity = maxTopicSimilarity(topic, usedTopics);
  const anglePenalty = angleKey && usedTopics.some((used) => inferredTopicAngleKey(used) === angleKey) ? 10 : 0;
  return clampScore(96 - similarity * 55 - anglePenalty);
}

function maxTopicSimilarity(topic: string, usedTopics: string[]): number {
  const candidate = topicFingerprint(topic);
  if (!candidate.normalized || usedTopics.length === 0) return 0;

  return usedTopics.reduce((max, used) => {
    const historical = topicFingerprint(used);
    if (!historical.normalized) return max;
    const normalizedMatch =
      candidate.normalized === historical.normalized ||
      candidate.normalized.includes(historical.normalized) ||
      historical.normalized.includes(candidate.normalized)
        ? 1
        : 0;
    return Math.max(max, normalizedMatch, tokenSimilarity(candidate.tokens, historical.tokens));
  }, 0);
}

function inferredTopicAngleKey(topic: string): string | undefined {
  const value = topic.toLowerCase();
  if (/vs\.?|compare|comparison|other|其他|怎么比|还是/.test(value)) return "comparison_decision";
  if (/checklist|before buying|pre-purchase|mistake|risk|检查|误区|购买前/.test(value)) return "mistake_avoidance";
  if (/gift|occasion|送礼|礼物/.test(value)) return "gift_moment";
  if (/commut|daily|style|outfit|scenario|场景|搭配|通勤/.test(value)) return "scenario_fit";
  if (/trend|means|之后|趋势|热点/.test(value)) return "trend_bridge";
  return undefined;
}

function shopperScenarios(context: ContentSourceContext, locale: SupportedLocale): string[] {
  const productText = [context.product?.title, context.product?.productType, ...(context.product?.tags ?? [])].join(" ").toLowerCase();
  const scenarioHints =
    locale === "zh-CN"
      ? [
          { test: /gift|present|礼物|送礼/, value: "送礼场景" },
          { test: /travel|trip|旅行/, value: "旅行出行" },
          { test: /student|school|学生|校园/, value: "学生日常" },
          { test: /magsafe|desk|office|办公|桌面/, value: "办公桌面" },
          { test: /street|heart|cross|街头/, value: "街头穿搭" },
          { test: /clear|minimal|透明|极简/, value: "极简搭配" }
        ]
      : [
          { test: /gift|present/, value: "gift shoppers" },
          { test: /travel|trip/, value: "travel days" },
          { test: /student|school/, value: "student routines" },
          { test: /magsafe|desk|office/, value: "desk setups" },
          { test: /street|heart|cross/, value: "streetwear looks" },
          { test: /clear|minimal/, value: "minimalist outfits" }
        ];
  const hinted = scenarioHints.filter((item) => item.test.test(productText)).map((item) => item.value);
  const defaults =
    locale === "zh-CN"
      ? ["日常通勤", "送礼场景", "旅行出行", "学生日常", "办公桌面", "周末出行", "极简搭配", "街头穿搭"]
      : ["daily commutes", "gift shoppers", "travel days", "student routines", "desk setups", "weekend plans", "minimalist outfits", "streetwear looks"];
  return unique([...hinted, ...defaults]);
}

function compactTrendConcept(signal: NonNullable<ContentSourceContext["trendSignals"]>[number], locale: SupportedLocale): string {
  const title = signal.title
    .replace(/\s[-|–]\s.*$/u, "")
    .replace(/\b(?:breaking|live updates?|latest|photos?|video)\b:?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = tokenizeSignal(title)
    .filter((token) => !trendConceptStopWords.has(token.toLowerCase()))
    .slice(0, locale === "zh-CN" ? 8 : 6);
  const compact = tokens.join(" ").trim();
  return compact || compactTitle(signal.title);
}

function uniqueFallbackTopic(keyword: string, categoryLabel: string, locale: SupportedLocale, usedTopics: string[]): string {
  for (let index = 1; index <= 20; index += 1) {
    const suffix = hashString(`${keyword}:${categoryLabel}:${usedTopics.join("|")}:${index}`).toString(36).slice(0, 4);
    const topic =
      locale === "zh-CN"
        ? `${keyword}新角度 ${suffix}：${categoryLabel}人群、场景和购买判断`
        : `${keyword} fresh angle ${suffix}: ${categoryLabel} audiences, scenarios, and buying checks`;
    if (!isRepeatedTopic(topic, usedTopics)) return topic;
  }

  return locale === "zh-CN"
    ? `${keyword}未覆盖角度：${categoryLabel}搜索需求拆解`
    : `${keyword} uncovered angle: ${categoryLabel} search demand breakdown`;
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

const trendConceptStopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "after",
  "before",
  "how",
  "what",
  "why",
  "new",
  "latest",
  "best",
  "top",
  "guide",
  "review",
  "reviews",
  "buy",
  "buying",
  "shop",
  "sale",
  "price",
  "deals",
  "near",
  "me"
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
      ? ["在当今", "不言而喻", "总的来说", "值得注意的是", "越来越多的人", "本文将深入探讨", "搜索意图覆盖", "写作时要", "这篇文章需要"]
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
