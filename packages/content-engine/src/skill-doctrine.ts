import type { SkillDoctrine } from "./types";
import type { SupportedLocale } from "./locales";

export function buildCommercialSkillDoctrine(locale: SupportedLocale): SkillDoctrine {
  const zh = locale === "zh-CN";

  return {
    version: "commercial-seo-skill-doctrine-1.1.0",
    sources: [
      {
        name: "codex-seo",
        url: "https://github.com/AgriciDaniel/codex-seo",
        lesson: "Use specialist SEO stages, evidence caches, quality gates, and explicit audit trails."
      },
      {
        name: "superseo write-content",
        url: "https://github.com/inhouseseo/superseo-skills",
        lesson: "Research first, match SERP/content type, write with information gain, and remove AI-slop patterns."
      },
      {
        name: "affiliate-skills flywheel",
        url: "https://github.com/Affitor/affiliate-skills",
        lesson: "Close the loop from research to content to analytics, and feed outcomes back into future planning."
      },
      {
        name: "SEO Machine",
        url: "https://github.com/TheCraigHewitt/seomachine",
        lesson: "Mirror the research-write-rewrite-analyze-publish-review loop with specialized commands, role clarity, and performance feedback."
      }
    ],
    requiredArticleModules: zh
      ? [
          "顶部直接答案",
          "已确认事实表",
          "选择/跳过决策模块",
          "对比或场景矩阵",
          "上下文内链",
          "外部参考来源引用",
          "搜索意图覆盖说明",
          "不少于 5 个真实搜索意图 FAQ",
          "买家导向结论"
        ]
      : [
          "answer-first block",
          "verified facts table",
          "choose-this-if / skip-this-if module",
          "comparison or scenario matrix",
          "contextual internal links",
          "external cited references",
          "search intent coverage note",
          "at least 5 search-intent FAQs",
          "buyer-facing conclusion"
        ],
    antiSlopRules: [
      "Do not use generic guide formulas, unsupported superlatives, vague trend claims, or repeated section templates.",
      "At least 30% of the article should contain source-specific details, product facts, decisions, caveats, or examples.",
      "Use trends as editorial leads only when relevance is clear; do not force unrelated Google Trends topics into copy.",
      "Every publishable article should cite approved external references; never invent source URLs.",
      "Prefer concrete shopper decisions over broad benefits: fit, variant, finish, care, gifting, styling, and not-confirmed details.",
      "Never optimize for AI-detector evasion; optimize for specificity, evidence, usefulness, and natural rhythm.",
      "Use market insights and competitor angles to sharpen the buyer decision, not to pad the copy."
    ],
    scoringRubric: [
      { dimension: "Search intent fit", weight: 22, passSignal: "The title, answer block, H2s, and FAQ match the same query intent." },
      { dimension: "Information gain", weight: 20, passSignal: "The article includes details that cannot be written from a generic template." },
      { dimension: "Evidence and factuality", weight: 18, passSignal: "Product facts, trend signals, and unknowns are clearly separated." },
      { dimension: "Decision usefulness", weight: 16, passSignal: "Readers can choose, skip, compare, or continue via a relevant link." },
      { dimension: "Authority links", weight: 12, passSignal: "Internal links and external citations are contextual, useful, and source-approved." },
      { dimension: "Human editorial rhythm", weight: 12, passSignal: "Paragraphs vary, claims are grounded, and boilerplate phrasing is absent." }
    ]
  };
}
