import type { SupportedLocale } from "./locales";
import type { PublishPolicy } from "./status";

export type SourceType = "product" | "collection" | "manual_topic";

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
