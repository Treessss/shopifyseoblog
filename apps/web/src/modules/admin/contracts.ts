export type StoreStatus = "installing" | "active" | "disconnected" | "suspended" | "archived";
export type AiProvider = "openai" | "compatible" | "custom";
export type SourceType = "product" | "collection" | "manual_topic";
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "failed";
export type PublishPolicy = "auto_when_qualified" | "manual_review" | "direct";
export type ArticleStatus = "draft" | "quality_failed" | "ready_to_publish" | "publishing" | "published" | "failed";
export type JobType =
  | "generate_article"
  | "translate_article"
  | "generate_asset"
  | "publish_article"
  | "sync_product"
  | "sync_collection";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "retrying";
export type PublishEvent = "queued" | "started" | "succeeded" | "failed" | "skipped" | "retry_scheduled";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "invite"
  | "login"
  | "oauth_connect"
  | "oauth_disconnect"
  | "publish"
  | "generate"
  | "sync";

export interface GenerationConfig {
  hotNews?: {
    enabled: boolean;
    query?: string;
    geo?: string;
    lookbackDays?: number;
    maxItems?: number;
    sources?: Array<"google_news" | "google_trends">;
  };
  internalLinks?: {
    enabled: boolean;
    maxLinks?: number;
    strategy?: "auto" | "product" | "collection" | "article";
  };
  externalReferences?: {
    enabled: boolean;
    minLinks?: number;
    maxLinks?: number;
    requireEveryArticle?: boolean;
  };
  imageGeneration?: {
    enabled: boolean;
    placement?: "featured" | "inline" | "both";
    imageCount?: number;
    promptStyle?: string;
    scenePrompt?: string;
    fusionMode?: "single_product" | "multi_product_fusion" | "lifestyle_scene";
    referenceImageLimit?: number;
  };
  productImageReference?: {
    enabled: boolean;
    source?: "source_product" | "selected_products" | "urls";
    productIds?: string[];
    imageUrls?: string[];
    maxImages?: number;
    maxImagesPerProduct?: number;
  };
  aiSearchReview?: {
    enabled: boolean;
    minTrafficScore?: number;
    maxRevisionPasses?: number;
  };
  qualityGate?: {
    enabled: boolean;
    minSeoScore?: number;
    minEditorialScore?: number;
    requireTrendEvidence?: boolean;
    rejectTemplatePatterns?: boolean;
  };
}

export interface AdminRequestContextInput {
  organizationSlug?: string;
  requestedByUserId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminOrganizationSummary {
  id: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  plan: string;
}

export interface ResolvedAdminContext extends AdminRequestContextInput {
  organization: AdminOrganizationSummary;
  organizationId: string;
}

export interface AdminMetric {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn" | "danger" | "neutral";
}

export interface AdminStoreOverview {
  id: string;
  name: string;
  domain: string;
  locale: string;
  status: string;
  statusCode: StoreStatus;
  products: number;
  collections: number;
  articles: number;
  campaigns: number;
  lastSync: string;
  lastSyncedAt: string | null;
  apiVersion: string;
  scopes: string[];
  hasAdminAccessToken: boolean;
  shopOwnerEmail: string | null;
  currencyCode: string | null;
  timezone: string | null;
  updatedAt: string;
}

export interface AdminCampaignOverview {
  id: string;
  name: string;
  title: string;
  store: string;
  storeId: string;
  locale: string;
  source: string;
  sourceType: SourceType;
  sourceId: string | null;
  topic: string | null;
  status: CampaignStatus;
  progress: number;
  progressLabel: string;
  progressStep: string | null;
  progressDetail: string | null;
  progressUpdatedAt: string | null;
  publishPolicy: string;
  publishPolicyCode: PublishPolicy;
  targetWordCount: number;
  primaryKeyword: string | null;
  keywords: string[];
  articles: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminArticleOverview {
  id: string;
  title: string;
  handle: string | null;
  store: string;
  storeId: string;
  campaignId: string | null;
  campaign: string | null;
  locale: string;
  sourceType: SourceType;
  sourceId: string | null;
  status: ArticleStatus;
  publishPolicy: PublishPolicy;
  seoScore: number;
  qualityPassed: boolean;
  updatedAt: string;
  updatedAtIso: string;
  publishedAt: string | null;
  canonicalUrl: string | null;
  primaryKeyword: string | null;
  failureReason: string | null;
}

export interface AdminArticleAssetOverview {
  id: string;
  type: string;
  status: string;
  publicUrl: string | null;
  sourceUrl: string | null;
  altText: string | null;
  prompt: string | null;
  createdAt: string;
}

export interface AdminArticleReviewOverview extends AdminArticleOverview {
  summary: string | null;
  bodyHtml: string | null;
  secondaryKeywords: string[];
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  shopifyBlogId: string | null;
  shopifyArticleId: string | null;
  scheduledAt: string | null;
  lastGeneratedAt: string | null;
  qualityReport: unknown;
  generationMetadata: unknown;
  assets: AdminArticleAssetOverview[];
  logs: AdminLogEntry[];
}

export interface AdminLogEntry {
  id: string;
  time: string;
  createdAt: string;
  level: "debug" | "info" | "warning" | "error";
  module: string;
  message: string;
  status: JobStatus;
  source: "publish" | "audit";
  storeId: string | null;
  articleId: string | null;
  jobId: string | null;
}

export interface AdminLanguageOverview {
  id: string;
  locale: string;
  label: string;
  enabled: boolean;
  fallback: string;
  role: string;
  isDefault: boolean;
  storeId: string;
  store: string;
  shopifyMarketHandle: string | null;
  shopifyBlogId: string | null;
  shopifyBlogHandle: string | null;
}

export interface AdminAiProviderOverview {
  id: string;
  slug: string;
  name: string;
  provider: string;
  baseUrl: string;
  textModel: string;
  imageModel: string | null;
  temperature: number;
  enabled: boolean;
  isDefault: boolean;
  storeId: string | null;
  store: string | null;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBrandVoiceProfile {
  id: string;
  locale: string;
  name: string;
  storeId: string | null;
  store: string | null;
  audience: string | null;
  tone: string | null;
  bannedWords: string[];
  examples: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  storeId: string;
  title: string;
  locale: string;
  sourceType: SourceType;
  sourceId?: string;
  topic?: string;
  brandVoiceId?: string;
  publishPolicy: PublishPolicy;
  targetWordCount: number;
  primaryKeyword?: string;
  keywords: string[];
  generationConfig?: GenerationConfig;
  scheduleAt?: string;
  queueGeneration: boolean;
}

export interface UpsertAiProviderInput {
  id?: string;
  storeId?: string;
  slug?: string;
  name: string;
  provider: "openai" | "compatible" | "custom";
  baseUrl: string;
  apiKey?: string;
  textModel: string;
  imageModel?: string;
  temperature: number;
  enabled: boolean;
  isDefault: boolean;
}

export interface UpsertLanguageInput {
  storeId: string;
  locale: string;
  label: string;
  fallback?: string;
  enabled: boolean;
  isDefault: boolean;
  shopifyMarketHandle?: string;
  shopifyBlogId?: string;
  shopifyBlogHandle?: string;
}

export interface UpsertStoreCredentialsInput {
  connectionMode: "manual_token" | "client_credentials";
  shopDomain: string;
  name?: string;
  adminAccessToken?: string;
  adminAccessTokenExpiresAt?: string;
  apiVersion: string;
  primaryLocale: string;
  shopifyBlogHandle?: string;
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  shopifyApiKey?: string;
  webhookSecret?: string;
  scopes: string[];
}

export interface UpsertBrandVoiceInput {
  id?: string;
  storeId?: string;
  locale: string;
  name: string;
  audience?: string;
  tone?: string;
  bannedWords: string[];
  examples: string[];
  isDefault: boolean;
}

export interface SaveAiSettingsInput {
  id?: string;
  storeId?: string;
  slug?: string;
  name: string;
  provider: AiProvider;
  baseUrl: string;
  apiKey?: string;
  textModel: string;
  imageModel?: string;
  temperature: number;
  enabled: boolean;
  isDefault: boolean;
}

export interface SaveLanguageInput {
  id?: string;
  storeId: string;
  locale: string;
  label: string;
  isEnabled: boolean;
  isDefault: boolean;
  shopifyMarketHandle?: string;
  shopifyBlogId?: string;
  shopifyBlogHandle?: string;
}

export interface SaveBrandVoiceInput {
  id?: string;
  storeId?: string;
  locale: string;
  name: string;
  audience?: string;
  tone?: string;
  bannedWords: string[];
  examples: string[];
  isDefault: boolean;
}

export interface QueueStoreSyncInput {
  storeId: string;
  fullSync: boolean;
  products: boolean;
  collections: boolean;
  limit?: number;
}

export interface DeleteStoreInput {
  storeId: string;
  confirmDomain?: string;
}

export interface QueueArticlePublishInput {
  articleId: string;
  publishAt?: string;
  shopifyBlogId?: string;
}

export interface QueuedJobSummary {
  id: string;
  type: JobType;
  status: JobStatus;
  runAt: string;
  createdAt: string;
  message: string;
}

export interface AuditLogCreateInput {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  storeId?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishLogCreateInput {
  storeId?: string;
  jobId?: string;
  articleId?: string;
  level?: LogLevel;
  message: string;
  payload?: Record<string, unknown>;
}
