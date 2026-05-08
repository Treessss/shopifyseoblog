import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from "./locales";
import type {
  ArticleDraft,
  ContentSourceContext,
  HtmlAssembler,
  HtmlAssemblyResult,
  KeywordPlan,
  KeywordPlanner,
  NormalizedContentPipelineInput,
  PromptBuilder,
  PromptBundle,
  QualityGate,
  QualityGateResult,
  SeoCheck,
  SeoScorer,
  SeoScoreResult
} from "./types";

export const defaultKeywordPlanner: KeywordPlanner = {
  plan(input, context) {
    const locale = normalizeLocale(input.locale);
    const topic = resolveTopic(input, context);
    const primaryKeyword = cleanKeyword(input.primaryKeyword ?? context.seedKeywords?.[0] ?? topic);
    const secondaryKeywords = unique([
      ...(context.seedKeywords ?? []),
      ...localizedKeywordVariants(primaryKeyword, locale),
      context.product?.productType,
      context.product?.vendor,
      context.collection?.title
    ]).filter((keyword) => keyword !== primaryKeyword);

    return {
      locale,
      primaryKeyword,
      secondaryKeywords: secondaryKeywords.slice(0, 8),
      longTailKeywords: localizedLongTailKeywords(primaryKeyword, topic, locale),
      searchIntent: input.sourceType === "manual_topic" ? "informational" : "commercial",
      audienceNeed: locale === "zh-CN" ? `理解 ${primaryKeyword} 的选择、使用和购买决策` : `Understand how to choose and use ${primaryKeyword}`
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

    const system = [
      `Write in ${language}.`,
      "You are an ecommerce SEO editor for a Shopify store.",
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
        `Target length: ${input.targetWordCount} words.`,
        "Return title, summary, H2 sections, shopper intent, FAQs, and image alt text."
      ].join("\n"),
      draftPrompt: [
        `Draft the article in ${language} using the approved outline.`,
        `Primary keyword must appear naturally in title, opening paragraph, at least one H2, and conclusion: ${keywords.primaryKeyword}.`,
        "Use concise HTML-ready paragraphs, no markdown fences, no fabricated discounts or medical claims.",
        productContextLine(context)
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
    const minSeoScore = 72;
    const wordCount = estimateWordCount(stripHtml(article.bodyHtml), input.locale);
    const minWords = Math.max(120, Math.floor(input.targetWordCount * 0.25));
    const body = stripHtml(article.bodyHtml).toLowerCase();
    const bannedWords = context.brandVoice?.bannedWords ?? [];
    const blockedWords = bannedWords.filter((word) => word && body.includes(word.toLowerCase()));
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (seo.score < minSeoScore) reasons.push(`SEO score ${seo.score} is below ${minSeoScore}.`);
    if (wordCount < minWords) reasons.push(`Estimated word count ${wordCount} is below ${minWords}.`);
    if (blockedWords.length > 0) reasons.push(`Banned words found: ${blockedWords.join(", ")}.`);
    if (!article.summary) warnings.push("Missing article summary.");
    if (!article.imageAlt) warnings.push("Missing image alt text.");

    return {
      passed: reasons.length === 0,
      minSeoScore,
      seoScore: seo.score,
      wordCount,
      reasons,
      warnings
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
    imagePrompt:
      locale === "zh-CN"
        ? `电商博客配图，主题是${keywords.primaryKeyword}，真实产品场景，干净背景，自然光`
        : `Ecommerce blog image for ${keywords.primaryKeyword}, realistic product context, clean background, natural light`,
    imageAlt: locale === "zh-CN" ? `${keywords.primaryKeyword}使用场景图` : `${keywords.primaryKeyword} usage context`
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

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
