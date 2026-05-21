import { z } from "zod";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locales";
import { PUBLISH_POLICIES } from "./status";

export const shopDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, "Shopify shop must be a myshopify.com domain");

export const localeSchema = z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE);

export const aiProviderConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  textModel: z.string().min(1),
  imageModel: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).default(0.8)
});

export const generationConfigSchema = z.object({
  seoAgent: z
    .object({
      enabled: z.boolean().default(true),
      agentMode: z.enum(["standard", "commercial"]).default("commercial"),
      targetOrganicGrowthPct: z.number().int().min(1).max(500).optional(),
      memoryWindowDays: z.number().int().min(7).max(730).default(180),
      minOpportunityScore: z.number().int().min(0).max(100).default(70),
      maxResearchQueries: z.number().int().min(1).max(8).default(5),
      requireEvidenceTrace: z.boolean().default(true)
    })
    .optional(),
  topicDiscovery: z
    .object({
      enabled: z.boolean().default(true),
      strategy: z.enum(["trend_product_fit", "seo_opportunity", "product_education"]).default("trend_product_fit"),
      maxCandidates: z.number().int().min(1).max(8).default(4),
      preferTrendSignals: z.boolean().default(true),
      minEvidenceScore: z.number().int().min(0).max(100).default(35)
    })
    .optional(),
  hotNews: z
    .object({
      enabled: z.boolean().default(false),
      query: z.string().trim().min(1).optional(),
      geo: z.string().trim().min(2).max(8).default("US"),
      lookbackDays: z.number().int().min(1).max(30).default(7),
      maxItems: z.number().int().min(1).max(12).default(5),
      sources: z.array(z.enum(["google_trends", "google_news"])).default(["google_news", "google_trends"])
    })
    .optional(),
  internalLinks: z
    .object({
      enabled: z.boolean().default(true),
      maxLinks: z.number().int().min(1).max(8).default(4),
      strategy: z.enum(["auto", "product", "collection", "article"]).default("auto")
    })
    .optional(),
  externalReferences: z
    .object({
      enabled: z.boolean().default(true),
      minLinks: z.number().int().min(1).max(5).default(1),
      maxLinks: z.number().int().min(1).max(8).default(3),
      requireEveryArticle: z.boolean().default(true)
    })
    .optional(),
  imageGeneration: z
    .object({
      enabled: z.boolean().default(true),
      placement: z.enum(["featured", "inline", "both"]).default("inline"),
      imageCount: z.number().int().min(1).max(4).default(3),
      promptStyle: z.string().trim().min(1).max(240).optional(),
      scenePrompt: z.string().trim().min(1).max(500).optional(),
      fusionMode: z.enum(["single_product", "multi_product_fusion", "lifestyle_scene"]).default("lifestyle_scene"),
      referenceImageLimit: z.number().int().min(1).max(8).default(6)
    })
    .optional(),
  productImageReference: z
    .object({
      enabled: z.boolean().default(true),
      source: z.enum(["source_product", "selected_products", "urls"]).default("source_product"),
      productIds: z.array(z.string().trim().min(1)).default([]),
      imageUrls: z.array(z.string().url()).default([]),
      maxImages: z.number().int().min(1).max(12).default(6),
      maxImagesPerProduct: z.number().int().min(1).max(6).default(2)
    })
    .optional(),
  qualityGate: z
    .object({
      enabled: z.boolean().default(true),
      minSeoScore: z.number().int().min(0).max(100).default(78),
      minEditorialScore: z.number().int().min(0).max(100).default(72),
      requireTrendEvidence: z.boolean().default(false),
      rejectTemplatePatterns: z.boolean().default(true)
    })
    .optional(),
  aiSearchReview: z
    .object({
      enabled: z.boolean().default(true),
      minTrafficScore: z.number().int().min(0).max(100).default(82),
      maxRevisionPasses: z.number().int().min(0).max(5).default(3)
    })
    .optional()
});

export const blogCampaignInputSchema = z.object({
  organizationId: z.string().min(1),
  storeId: z.string().min(1),
  locale: localeSchema,
  sourceType: z.enum(["product", "collection", "manual_topic"]),
  sourceId: z.string().optional(),
  topic: z.string().min(2).optional(),
  publishPolicy: z.enum(PUBLISH_POLICIES).default("auto_when_qualified"),
  targetWordCount: z.number().int().min(600).max(3500).default(1400),
  primaryKeyword: z.string().optional(),
  keywords: z.array(z.string().trim().min(1)).default([]).optional(),
  generationConfig: generationConfigSchema.optional()
});

export const productContextSchema = z.object({
  id: z.string(),
  title: z.string(),
  handle: z.string().optional(),
  description: z.string().optional(),
  productType: z.string().optional(),
  vendor: z.string().optional(),
  tags: z.array(z.string()).default([]),
  imageUrls: z.array(z.string().url()).default([]),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional()
});

export const generatedArticleSchema = z.object({
  title: z.string().min(8),
  handle: z.string().min(2),
  summary: z.string().min(20),
  bodyHtml: z.string().min(200),
  primaryKeyword: z.string().min(2),
  secondaryKeywords: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  locale: localeSchema,
  seoScore: z.number().min(0).max(100),
  qualityPassed: z.boolean(),
  imagePrompt: z.string().optional(),
  imageAlt: z.string().optional()
});
