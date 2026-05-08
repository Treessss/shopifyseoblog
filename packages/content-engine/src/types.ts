import type {
  BlogCampaignInput,
  BrandVoice,
  GeneratedArticle,
  ProductContext,
  PublishPolicy,
  SourceType,
  SupportedLocale
} from "@shopify-ai-blog/shared";

export type {
  BlogCampaignInput,
  BrandVoice,
  GeneratedArticle,
  ProductContext,
  PublishPolicy,
  SourceType,
  SupportedLocale
} from "@shopify-ai-blog/shared";

export interface CollectionContext {
  id: string;
  title: string;
  handle?: string;
  description?: string;
  imageUrls?: string[];
}

export interface ContentSourceContext {
  product?: ProductContext;
  collection?: CollectionContext;
  brandVoice?: BrandVoice;
  topic?: string;
  seedKeywords?: string[];
  competitorTitles?: string[];
}

export interface ContentPipelineInput extends Omit<Partial<BlogCampaignInput>, "locale"> {
  locale?: SupportedLocale | string;
  topic?: string;
  targetWordCount?: number;
}

export interface KeywordPlan {
  locale: SupportedLocale;
  primaryKeyword: string;
  secondaryKeywords: string[];
  longTailKeywords: string[];
  searchIntent: "informational" | "commercial" | "transactional" | "navigational";
  audienceNeed: string;
}

export interface KeywordPlanner {
  plan(input: NormalizedContentPipelineInput, context: ContentSourceContext): MaybePromise<KeywordPlan>;
}

export interface PromptBundle {
  system: string;
  outlinePrompt: string;
  draftPrompt: string;
}

export interface PromptBuilder {
  build(input: NormalizedContentPipelineInput, context: ContentSourceContext, keywords: KeywordPlan): MaybePromise<PromptBundle>;
}

export interface OutlineSection {
  heading: string;
  intent: string;
  bulletPoints: string[];
  targetWords: number;
}

export interface ArticleDraft {
  title: string;
  handle?: string;
  summary: string;
  intro: string;
  sections: OutlineSection[];
  conclusion: string;
  tags: string[];
  imagePrompt?: string;
  imageAlt?: string;
}

export interface HtmlAssemblyResult {
  title: string;
  handle: string;
  summary: string;
  bodyHtml: string;
  tags: string[];
  imagePrompt?: string;
  imageAlt?: string;
}

export interface HtmlAssembler {
  assemble(
    input: NormalizedContentPipelineInput,
    context: ContentSourceContext,
    keywords: KeywordPlan,
    draft: ArticleDraft
  ): MaybePromise<HtmlAssemblyResult>;
}

export interface SeoCheck {
  id: string;
  label: string;
  passed: boolean;
  points: number;
  maxPoints: number;
}

export interface SeoScoreResult {
  score: number;
  checks: SeoCheck[];
  recommendations: string[];
}

export interface SeoScorer {
  score(article: HtmlAssemblyResult, keywords: KeywordPlan, input: NormalizedContentPipelineInput): MaybePromise<SeoScoreResult>;
}

export interface QualityGateResult {
  passed: boolean;
  minSeoScore: number;
  seoScore: number;
  wordCount: number;
  reasons: string[];
  warnings: string[];
}

export interface QualityGate {
  evaluate(
    article: HtmlAssemblyResult,
    seo: SeoScoreResult,
    input: NormalizedContentPipelineInput,
    context: ContentSourceContext
  ): MaybePromise<QualityGateResult>;
}

export interface ContentPipelineArtifacts {
  keywords: KeywordPlan;
  prompts: PromptBundle;
  draft: ArticleDraft;
  html: HtmlAssemblyResult;
  seo: SeoScoreResult;
  quality: QualityGateResult;
}

export interface ContentPipelineResult {
  article: GeneratedArticle;
  artifacts: ContentPipelineArtifacts;
}

export interface NormalizedContentPipelineInput {
  organizationId?: string;
  storeId?: string;
  locale: SupportedLocale;
  sourceType: SourceType;
  sourceId?: string;
  topic: string;
  publishPolicy: PublishPolicy;
  targetWordCount: number;
  primaryKeyword?: string;
}

export interface ContentPipelineRunOptions {
  keywordPlanner?: string;
  promptBuilder?: string;
  htmlAssembler?: string;
  seoScorer?: string;
  qualityGate?: string;
}

export type MaybePromise<T> = T | Promise<T>;
