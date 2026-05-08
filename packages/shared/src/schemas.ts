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

export const blogCampaignInputSchema = z.object({
  organizationId: z.string().min(1),
  storeId: z.string().min(1),
  locale: localeSchema,
  sourceType: z.enum(["product", "collection", "manual_topic"]),
  sourceId: z.string().optional(),
  topic: z.string().min(2).optional(),
  publishPolicy: z.enum(PUBLISH_POLICIES).default("auto_when_qualified"),
  targetWordCount: z.number().int().min(600).max(3500).default(1400),
  primaryKeyword: z.string().optional()
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
