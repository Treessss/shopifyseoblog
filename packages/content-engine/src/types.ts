import type {
  BlogCampaignInput,
  BrandVoice,
  GenerationConfig,
  GeneratedArticle,
  ProductContext,
  PublishPolicy,
  SourceType,
  SupportedLocale
} from "@shopify-ai-blog/shared";

export type {
  BlogCampaignInput,
  BrandVoice,
  GenerationConfig,
  GeneratedArticle,
  ProductContext,
  PublishPolicy,
  SourceType
} from "@shopify-ai-blog/shared";

export interface CollectionContext {
  id: string;
  title: string;
  handle?: string;
  description?: string;
  imageUrls?: string[];
}

export interface TrendSignal {
  title: string;
  source: string;
  url?: string;
  summary?: string;
  publishedAt?: string;
  traffic?: string;
  imageUrl?: string;
  relevanceScore?: number;
}

export interface InternalLinkCandidate {
  title: string;
  url: string;
  type: "product" | "collection" | "article";
  anchor?: string;
  reason?: string;
}

export interface ImageReference {
  url: string;
  source: "product" | "collection" | "manual";
  title?: string;
}

export interface KeywordEvidenceItem {
  type: "product" | "collection" | "seed_keyword" | "trend" | "internal_link";
  source: string;
  label: string;
  value: string;
  url?: string;
  snippet?: string;
  publishedAt?: string;
  metric?: string;
  relevanceScore?: number;
  confidence: number;
}

export interface TopicCandidate {
  topic: string;
  primaryKeyword: string;
  score: number;
  reasons: string[];
  evidence: KeywordEvidenceItem[];
}

export interface TopicSelectionResult {
  selected: TopicCandidate;
  candidates: TopicCandidate[];
}

export interface TopicHistoryItem {
  topic?: string;
  title?: string;
  primaryKeyword?: string;
  sourceType?: SourceType;
  sourceId?: string;
  createdAt?: string;
}

export interface ContentSourceContext {
  product?: ProductContext;
  collection?: CollectionContext;
  brandVoice?: BrandVoice;
  topic?: string;
  seedKeywords?: string[];
  competitorTitles?: string[];
  trendSignals?: TrendSignal[];
  internalLinks?: InternalLinkCandidate[];
  imageReferences?: ImageReference[];
  keywordEvidence?: KeywordEvidenceItem[];
  topicSelection?: TopicSelectionResult;
  recentTopics?: TopicHistoryItem[];
  generationConfig?: GenerationConfig;
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
  evidence?: string[];
  evidenceItems?: KeywordEvidenceItem[];
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
  editorial?: EditorialQualityResult;
}

export interface EditorialQualityResult {
  score: number;
  passed: boolean;
  signals: string[];
  recommendations: string[];
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
  topicSelection?: TopicSelectionResult;
  keywordEvidence?: KeywordEvidenceItem[];
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
  generationConfig?: GenerationConfig;
}

export interface ContentPipelineRunOptions {
  keywordPlanner?: string;
  promptBuilder?: string;
  htmlAssembler?: string;
  seoScorer?: string;
  qualityGate?: string;
}

export type MaybePromise<T> = T | Promise<T>;
