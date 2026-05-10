import type { SupportedLocale } from "./locales";
import type { PublishPolicy } from "./status";

export type SourceType = "product" | "collection" | "manual_topic";
export type TrendSource = "google_trends" | "google_news";
export type InternalLinkStrategy = "auto" | "product" | "collection" | "article";
export type ImagePlacement = "featured" | "inline" | "both";
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

export interface ImageGenerationConfig {
  enabled: boolean;
  placement?: ImagePlacement;
  promptStyle?: string;
}

export interface ProductImageReferenceConfig {
  enabled: boolean;
  source?: ProductImageReferenceSource;
  productIds?: string[];
  imageUrls?: string[];
}

export interface QualityGateConfig {
  enabled: boolean;
  minSeoScore?: number;
  minEditorialScore?: number;
  requireTrendEvidence?: boolean;
  rejectTemplatePatterns?: boolean;
}

export interface GenerationConfig {
  hotNews?: HotNewsConfig;
  internalLinks?: InternalLinksConfig;
  imageGeneration?: ImageGenerationConfig;
  productImageReference?: ProductImageReferenceConfig;
  qualityGate?: QualityGateConfig;
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
