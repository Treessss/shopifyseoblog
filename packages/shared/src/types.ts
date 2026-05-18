import type { SupportedLocale } from "./locales";
import type { PublishPolicy } from "./status";

export type SourceType = "product" | "collection" | "manual_topic";
export type TrendSource = "google_trends" | "google_news";
export type InternalLinkStrategy = "auto" | "product" | "collection" | "article";
export type ImagePlacement = "featured" | "inline" | "both";
export type TopicDiscoveryStrategy = "trend_product_fit" | "seo_opportunity" | "product_education";
export type ImageFusionMode = "single_product" | "multi_product_fusion" | "lifestyle_scene";
export type ProductImageReferenceSource = "source_product" | "selected_products" | "urls";

export interface ProductContext {
  id: string;
  title: string;
  handle?: string;
  description?: string;
  productType?: string;
  vendor?: string;
  tags: string[];
  imageUrls: string[];
  seoTitle?: string;
  seoDescription?: string;
}

export interface BrandVoice {
  locale: SupportedLocale;
  audience?: string;
  tone?: string;
  bannedWords: string[];
  examples: string[];
}

export interface HotNewsConfig {
  enabled: boolean;
  query?: string;
  geo?: string;
  lookbackDays?: number;
  maxItems?: number;
  sources?: TrendSource[];
}

export interface InternalLinksConfig {
  enabled: boolean;
  maxLinks?: number;
  strategy?: InternalLinkStrategy;
}

export interface TopicDiscoveryConfig {
  enabled: boolean;
  strategy?: TopicDiscoveryStrategy;
  maxCandidates?: number;
  preferTrendSignals?: boolean;
  minEvidenceScore?: number;
}

export interface ImageGenerationConfig {
  enabled: boolean;
  placement?: ImagePlacement;
  promptStyle?: string;
  scenePrompt?: string;
  fusionMode?: ImageFusionMode;
  referenceImageLimit?: number;
}

export interface ProductImageReferenceConfig {
  enabled: boolean;
  source?: ProductImageReferenceSource;
  productIds?: string[];
  imageUrls?: string[];
  maxImages?: number;
  maxImagesPerProduct?: number;
}

export interface QualityGateConfig {
  enabled: boolean;
  minSeoScore?: number;
  minEditorialScore?: number;
  requireTrendEvidence?: boolean;
  rejectTemplatePatterns?: boolean;
}

export interface AiSearchReviewConfig {
  enabled: boolean;
  minTrafficScore?: number;
  maxRevisionPasses?: number;
}

export interface GenerationConfig {
  topicDiscovery?: TopicDiscoveryConfig;
  hotNews?: HotNewsConfig;
  internalLinks?: InternalLinksConfig;
  imageGeneration?: ImageGenerationConfig;
  productImageReference?: ProductImageReferenceConfig;
  qualityGate?: QualityGateConfig;
  aiSearchReview?: AiSearchReviewConfig;
}

export interface BlogCampaignInput {
  organizationId: string;
  storeId: string;
  locale: SupportedLocale;
  sourceType: SourceType;
  sourceId?: string;
  topic?: string;
  publishPolicy: PublishPolicy;
  targetWordCount: number;
  primaryKeyword?: string;
  keywords?: string[];
  generationConfig?: GenerationConfig;
}

export interface GeneratedArticle {
  title: string;
  handle: string;
  summary: string;
  bodyHtml: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  tags: string[];
  locale: SupportedLocale;
  seoScore: number;
  qualityPassed: boolean;
  imagePrompt?: string;
  imageAlt?: string;
}
