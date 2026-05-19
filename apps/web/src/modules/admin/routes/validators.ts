import { AdminApiError } from "../policies/errors";
import { localeSchema, shopDomainSchema } from "@shopify-ai-blog/shared";
import type {
  CreateCampaignInput,
  DeleteStoreInput,
  QueueArticlePublishInput,
  QueueStoreSyncInput,
  UpsertAiProviderInput,
  UpsertBrandVoiceInput,
  UpsertLanguageInput,
  UpsertStoreCredentialsInput
} from "../contracts";

const SOURCE_TYPES = ["product", "collection", "manual_topic"] as const;
const PUBLISH_POLICIES = ["auto_when_qualified", "manual_review", "direct"] as const;
const AI_PROVIDERS = ["openai", "compatible", "custom"] as const;
const STORE_CONNECTION_MODES = ["manual_token", "client_credentials"] as const;

export async function parseQueueStoreSyncRequest(request: Request): Promise<QueueStoreSyncInput> {
  const body = await readRequestObject(request);

  return {
    storeId: requiredString(body, "storeId"),
    fullSync: booleanValue(body.fullSync, false),
    products: booleanValue(body.products, true),
    collections: booleanValue(body.collections, true),
    limit: optionalInteger(body.limit, "limit", 1, 2500)
  };
}

export async function parseDeleteStoreRequest(request: Request): Promise<DeleteStoreInput> {
  const body = await readRequestObject(request);

  return {
    storeId: requiredString(body, "storeId"),
    confirmDomain: optionalString(body.confirmDomain)
  };
}

export async function parseUpsertStoreCredentialsRequest(request: Request): Promise<UpsertStoreCredentialsInput> {
  const body = await readRequestObject(request);
  const connectionMode =
    optionalEnum(body.connectionMode, STORE_CONNECTION_MODES, "connectionMode") ??
    (optionalString(body.clientId) || optionalString(body.clientSecret) ? "client_credentials" : "manual_token");
  const parsedDomain = shopDomainSchema.safeParse(requiredString(body, "shopDomain"));
  if (!parsedDomain.success) {
    throw new AdminApiError(400, "SHOP_DOMAIN_INVALID", "shopDomain must be a valid myshopify.com domain.");
  }

  const parsedLocale = localeSchema.safeParse(optionalString(body.primaryLocale) ?? "zh-CN");
  if (!parsedLocale.success) {
    throw new AdminApiError(400, "PRIMARY_LOCALE_INVALID", "primaryLocale is invalid.");
  }

  const adminAccessToken = optionalString(body.adminAccessToken);
  const clientId = optionalString(body.clientId);
  const clientSecret = optionalString(body.clientSecret);

  if (connectionMode === "manual_token" && !adminAccessToken) {
    throw new AdminApiError(400, "ADMIN_ACCESS_TOKEN_REQUIRED", "adminAccessToken is required.");
  }

  if (connectionMode === "client_credentials" && (!clientId || !clientSecret)) {
    throw new AdminApiError(400, "SHOPIFY_CLIENT_CREDENTIALS_REQUIRED", "clientId and clientSecret are required.");
  }

  return {
    connectionMode,
    shopDomain: parsedDomain.data,
    name: optionalString(body.name),
    adminAccessToken,
    apiVersion: apiVersionValue(body.apiVersion),
    primaryLocale: parsedLocale.data,
    shopifyBlogHandle: optionalString(body.shopifyBlogHandle),
    shopifyClientId: clientId,
    shopifyClientSecret: clientSecret,
    shopifyApiKey: optionalString(body.shopifyApiKey),
    webhookSecret: optionalString(body.webhookSecret),
    scopes: stringList(body.scopes)
  };
}

export async function parseCreateCampaignRequest(request: Request): Promise<CreateCampaignInput> {
  const body = await readRequestObject(request);
  const sourceType = optionalEnum(body.sourceType, SOURCE_TYPES, "sourceType") ?? "manual_topic";
  const publishPolicy =
    optionalEnum(body.publishPolicy, PUBLISH_POLICIES, "publishPolicy") ?? "auto_when_qualified";
  const scheduleAt = optionalDateString(body.scheduleAt, "scheduleAt");
  const topic = optionalString(body.topic);
  const primaryKeyword = optionalString(body.primaryKeyword);
  const keywords = stringList(body.keywords);
  const sourceId = optionalString(body.sourceId);
  const topicDiscoveryEnabled = booleanValue(body.topicDiscoveryEnabled, true);

  if (!topicDiscoveryEnabled && !topic) {
    throw new AdminApiError(400, "TOPIC_REQUIRED", "topic is required when automatic topic discovery is disabled.");
  }
  return {
    storeId: requiredString(body, "storeId"),
    title: optionalString(body.title) ?? buildCampaignTitle(body, sourceType),
    locale: requiredString(body, "locale"),
    sourceType,
    sourceId,
    topic,
    brandVoiceId: optionalString(body.brandVoiceId),
    publishPolicy,
    targetWordCount: integerValue(body.targetWordCount, "targetWordCount", 1400, 300, 3500),
    primaryKeyword,
    keywords,
    generationConfig: parseGenerationConfig(body),
    scheduleAt,
    queueGeneration: booleanValue(body.queueGeneration, true)
  };
}

function buildCampaignTitle(body: Record<string, unknown>, sourceType: (typeof SOURCE_TYPES)[number]) {
  const topic = optionalString(body.topic);
  const keyword = optionalString(body.primaryKeyword);
  const sourceId = optionalString(body.sourceId);
  const basis = topic ?? keyword ?? sourceId;
  const prefix = booleanValue(body.topicDiscoveryEnabled, true) ? "自动选题" : "内容任务";
  const sourceLabel =
    sourceType === "product" ? "商品" : sourceType === "collection" ? "集合" : "主题";
  const date = new Date().toISOString().slice(0, 10);

  return basis ? `${prefix} · ${basis}` : `${prefix} · ${sourceLabel} · ${date}`;
}

export async function parseQueueArticlePublishRequest(request: Request): Promise<QueueArticlePublishInput> {
  const body = await readRequestObject(request);

  return {
    articleId: requiredString(body, "articleId"),
    publishAt: optionalDateString(body.publishAt, "publishAt"),
    shopifyBlogId: optionalString(body.shopifyBlogId)
  };
}

export async function parseUpsertAiProviderRequest(request: Request): Promise<UpsertAiProviderInput> {
  const body = await readRequestObject(request);
  const provider = optionalEnum(body.provider, AI_PROVIDERS, "provider") ?? "compatible";

  return {
    id: optionalString(body.id),
    storeId: optionalString(body.storeId),
    slug: optionalString(body.slug),
    name: requiredString(body, "name"),
    provider,
    baseUrl: requiredString(body, "baseUrl"),
    apiKey: optionalString(body.apiKey),
    textModel: requiredString(body, "textModel"),
    imageModel: optionalString(body.imageModel),
    temperature: integerOrFloatValue(body.temperature, "temperature", 0.8, 0, 2),
    enabled: booleanValue(body.enabled, true),
    isDefault: booleanValue(body.isDefault, false)
  };
}

export async function parseUpsertLanguageRequest(request: Request): Promise<UpsertLanguageInput> {
  const body = await readRequestObject(request);

  return {
    storeId: requiredString(body, "storeId"),
    locale: requiredString(body, "locale"),
    label: requiredString(body, "label"),
    fallback: optionalString(body.fallback),
    enabled: booleanValue(body.enabled, true),
    isDefault: booleanValue(body.isDefault, false),
    shopifyMarketHandle: optionalString(body.shopifyMarketHandle),
    shopifyBlogId: optionalString(body.shopifyBlogId),
    shopifyBlogHandle: optionalString(body.shopifyBlogHandle)
  };
}

export async function parseUpsertBrandVoiceRequest(request: Request): Promise<UpsertBrandVoiceInput> {
  const body = await readRequestObject(request);

  return {
    id: optionalString(body.id),
    storeId: optionalString(body.storeId),
    locale: requiredString(body, "locale"),
    name: requiredString(body, "name"),
    audience: optionalString(body.audience),
    tone: optionalString(body.tone),
    bannedWords: stringList(body.bannedWords),
    examples: stringList(body.examples),
    isDefault: booleanValue(body.isDefault, false)
  };
}

async function readRequestObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const raw = await request.text();
    if (!raw.trim()) return {};

    try {
      return asRecord(JSON.parse(raw) as unknown);
    } catch {
      throw new AdminApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
    }
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const output: Record<string, unknown> = {};

    for (const [key, value] of form.entries()) {
      if (typeof value !== "string") continue;
      const existing = output[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else if (typeof existing === "string") {
        output[key] = [existing, value];
      } else {
        output[key] = value;
      }
    }

    return output;
  }

  return {};
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new AdminApiError(400, "REQUEST_BODY_INVALID", "Request body must be a JSON object.");
}

function requiredString(body: Record<string, unknown>, key: string) {
  const value = optionalString(body[key]);
  if (!value) {
    throw new AdminApiError(400, `${key.toUpperCase()}_REQUIRED`, `${key} is required.`);
  }
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringList(value: unknown) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  throw new AdminApiError(400, "KEYWORDS_INVALID", "keywords must be an array or comma-separated string.");
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }

  throw new AdminApiError(400, "BOOLEAN_INVALID", "Boolean fields must be true or false.");
}

function integerValue(value: unknown, key: string, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AdminApiError(400, `${key.toUpperCase()}_INVALID`, `${key} must be an integer between ${min} and ${max}.`);
  }

  return number;
}

function integerOrFloatValue(value: unknown, key: string, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AdminApiError(400, `${key.toUpperCase()}_INVALID`, `${key} must be a number between ${min} and ${max}.`);
  }

  return number;
}

function optionalInteger(value: unknown, key: string, min: number, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return integerValue(value, key, 0, min, max);
}

function apiVersionValue(value: unknown) {
  const version = optionalString(value) ?? "2026-04";
  if (!/^\d{4}-\d{2}$/.test(version)) {
    throw new AdminApiError(400, "API_VERSION_INVALID", "apiVersion must use YYYY-MM format.");
  }
  return version;
}

function parseGenerationConfig(body: Record<string, unknown>) {
  return {
    topicDiscovery: {
      enabled: booleanValue(body.topicDiscoveryEnabled, true),
      strategy:
        optionalEnum(body.topicDiscoveryStrategy, ["trend_product_fit", "seo_opportunity", "product_education"] as const, "topicDiscoveryStrategy") ??
        "trend_product_fit",
      maxCandidates: optionalInteger(body.topicDiscoveryMaxCandidates, "topicDiscoveryMaxCandidates", 1, 8) ?? 4,
      preferTrendSignals: booleanValue(body.preferTrendSignals, true),
      minEvidenceScore: optionalInteger(body.minEvidenceScore, "minEvidenceScore", 0, 100) ?? 35
    },
    hotNews: {
      enabled: booleanValue(body.hotNewsEnabled, false),
      query: optionalString(body.hotNewsQuery),
      geo: optionalString(body.hotNewsGeo) ?? "US",
      lookbackDays: optionalInteger(body.hotNewsLookbackDays, "hotNewsLookbackDays", 1, 30) ?? 7,
      maxItems: optionalInteger(body.hotNewsMaxItems, "hotNewsMaxItems", 1, 12) ?? 5,
      sources: normalizeTrendSources(body.hotNewsSources)
    },
    internalLinks: {
      enabled: booleanValue(body.internalLinksEnabled, true),
      maxLinks: optionalInteger(body.internalLinksMaxLinks, "internalLinksMaxLinks", 1, 8) ?? 4,
      strategy: optionalEnum(body.internalLinksStrategy, ["auto", "product", "collection", "article"] as const, "internalLinksStrategy") ?? "auto"
    },
    imageGeneration: {
      enabled: booleanValue(body.imageGenerationEnabled, true),
      placement: optionalEnum(body.imagePlacement, ["featured", "inline", "both"] as const, "imagePlacement") ?? "inline",
      promptStyle: optionalString(body.imagePromptStyle),
      scenePrompt: optionalString(body.imageScenePrompt),
      fusionMode:
        optionalEnum(body.imageFusionMode, ["single_product", "multi_product_fusion", "lifestyle_scene"] as const, "imageFusionMode") ??
        "lifestyle_scene",
      referenceImageLimit: optionalInteger(body.referenceImageLimit, "referenceImageLimit", 1, 8) ?? 6
    },
    productImageReference: {
      enabled: booleanValue(body.productImageReferenceEnabled, true),
      source:
        optionalEnum(
          body.productImageReferenceSource,
          ["source_product", "selected_products", "urls"] as const,
          "productImageReferenceSource"
        ) ?? "source_product",
      productIds: stringList(body.referenceProductIds),
      imageUrls: stringList(body.referenceImageUrls),
      maxImages: optionalInteger(body.maxReferenceImages, "maxReferenceImages", 1, 12) ?? 6,
      maxImagesPerProduct: optionalInteger(body.maxImagesPerProduct, "maxImagesPerProduct", 1, 6) ?? 2
    },
    qualityGate: {
      enabled: booleanValue(body.qualityGateEnabled, true),
      minSeoScore: optionalInteger(body.minSeoScore, "minSeoScore", 0, 100) ?? 78,
      minEditorialScore: optionalInteger(body.minEditorialScore, "minEditorialScore", 0, 100) ?? 72,
      requireTrendEvidence: booleanValue(body.requireTrendEvidence, false),
      rejectTemplatePatterns: booleanValue(body.rejectTemplatePatterns, true)
    },
    aiSearchReview: {
      enabled: booleanValue(body.aiSearchReviewEnabled, true),
      minTrafficScore: optionalInteger(body.minTrafficScore, "minTrafficScore", 0, 100) ?? 82,
      maxRevisionPasses: optionalInteger(body.maxRevisionPasses, "maxRevisionPasses", 0, 5) ?? 3
    }
  };
}

function normalizeTrendSources(value: unknown): Array<"google_news" | "google_trends"> {
  const values = stringList(value).filter((item): item is "google_news" | "google_trends" =>
    ["google_news", "google_trends"].includes(item)
  );
  return values.length ? values : ["google_news", "google_trends"];
}

function optionalEnum<T extends readonly string[]>(value: unknown, allowed: T, key: string): T[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T[number];

  throw new AdminApiError(400, `${key.toUpperCase()}_INVALID`, `${key} is invalid.`);
}

function optionalDateString(value: unknown, key: string) {
  const raw = optionalString(value);
  if (!raw) return undefined;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AdminApiError(400, `${key.toUpperCase()}_INVALID`, `${key} must be a valid date string.`);
  }

  return date.toISOString();
}
