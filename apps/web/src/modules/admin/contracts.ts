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
  | "sync_collection"
  | "sync_search_console";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "retrying";
export type PublishEvent = "queued" | "started" | "succeeded" | "failed" | "skipped" | "retry_scheduled";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type SearchConsolePropertyStatus = "active" | "needs_auth" | "disconnected" | "archived";
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

export interface AdminDashboardQueueHealth {
  queuedJobs: number;
  runningJobs: number;
  retryingJobs: number;
  failedJobs: number;
  activeJobs: number;
  pendingJobs: number;
  tone: "good" | "warn" | "danger" | "neutral";
  label: string;
  nextStep: string;
  lastFailedJobId: string | null;
  lastFailedJobType: JobType | null;
  lastFailedAt: string | null;
  lastFailedMessage: string | null;
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
  progressStage: string | null;
  progressNextStep: string | null;
  progressRecoverable: boolean;
  progressArticleId: string | null;
  progressIsStale: boolean;
  progressStaleMinutes: number | null;
  progressStaleReason: string | null;
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
  indexReadiness: AdminArticleIndexReadiness;
}

export interface AdminArticleIndexReadiness {
  score: number;
  label: string;
  tone: "good" | "warn" | "danger" | "neutral";
  nextStep: string;
  checks: AdminArticleIndexReadinessCheck[];
  lastSearchConsoleSyncAt: string | null;
}

export interface AdminArticleIndexReadinessCheck {
  key: "content_quality" | "published_url" | "canonical_url" | "search_console";
  label: string;
  passed: boolean;
  detail: string;
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
  repairJob: QueuedJobSummary | null;
  seoPerformance: AdminArticleSeoPerformanceOverview | null;
}

export interface AdminArticleSeoPerformanceQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  opportunity: "quick_win" | "low_ctr" | "observe";
}

export interface AdminArticleSeoPerformanceOverview {
  snapshotId: string;
  propertyId: string;
  siteUrl: string;
  pageUrl: string;
  startDate: string;
  endDate: string;
  dataState: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  queryCount: number;
  topQuery: string | null;
  performanceScore: number | null;
  syncedAt: string;
  queries: AdminArticleSeoPerformanceQuery[];
  recommendations: string[];
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

export interface AdminSearchConsolePropertyOverview {
  id: string;
  storeId: string;
  store: string;
  publishedSiteUrl: string;
  siteUrl: string;
  status: SearchConsolePropertyStatus;
  statusTone: "good" | "warn" | "danger" | "neutral";
  permissionLevel: string | null;
  scopes: string[];
  hasOAuthClient: boolean;
  hasClientSecret: boolean;
  hasRefreshToken: boolean;
  snapshotCount: number;
  queryRowCount: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSearchConsoleSnapshotOverview {
  id: string;
  propertyId: string;
  storeId: string;
  store: string;
  articleId: string;
  article: string;
  siteUrl: string;
  pageUrl: string;
  startDate: string;
  endDate: string;
  dataState: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  queryCount: number;
  topQuery: string | null;
  performanceScore: number | null;
  syncedAt: string;
  source: string;
}

export interface AdminSearchConsoleView {
  properties: AdminSearchConsolePropertyOverview[];
  snapshots: AdminSearchConsoleSnapshotOverview[];
  stores: Array<{
    id: string;
    name: string;
    domain: string;
    publishedSiteUrl: string;
    defaultSiteUrl: string;
  }>;
}

export type AdminPriorityKind =
  | "quick_win"
  | "declining"
  | "low_ctr"
  | "topic_opportunity"
  | "reflection_task"
  | "agent_step"
  | "memory_risk";

export type AdminPriorityActionType =
  | "review_article"
  | "sync_search_console"
  | "publish_article"
  | "repair_article"
  | "open_campaign"
  | "new_campaign"
  | "open_search_console"
  | "view_run";

export type AdminPriorityLevel = "critical" | "high" | "medium" | "low";

export interface AdminCampaignDraft {
  storeId: string | null;
  locale: string | null;
  sourceType: SourceType;
  sourceId: string | null;
  topic: string | null;
  primaryKeyword: string | null;
  keywords: string[];
  publishPolicy: PublishPolicy;
  targetWordCount: number;
}

export interface AdminPriorityBoardItem {
  id: string;
  kind: AdminPriorityKind;
  level: AdminPriorityLevel;
  score: number;
  title: string;
  summary: string;
  reason: string;
  actionLabel: string;
  actionType: AdminPriorityActionType;
  actionHref: string | null;
  repairReason: string | null;
  articleId: string | null;
  campaignId: string | null;
  topicRunId: string | null;
  storeId: string | null;
  store: string | null;
  article: string | null;
  campaign: string | null;
  locale: string | null;
  campaignDraft?: AdminCampaignDraft | null;
  evidence: string[];
  metrics: {
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    position: number | null;
    performanceScore: number | null;
    changePercent: number | null;
    opportunityScore: number | null;
    memoryRisk: number | null;
    potentialClicks: number | null;
  };
  updatedAt: string;
}

export interface AdminPriorityBoardSummary {
  quickWins: number;
  declining: number;
  lowCtr: number;
  topicOpportunities: number;
  reflectionTasks: number;
  stepWarnings: number;
  memoryRisks: number;
  potentialClickGain: number;
}

export interface AdminPriorityBoardView {
  organization: AdminOrganizationSummary;
  generatedAt: string;
  summary: AdminPriorityBoardSummary;
  items: AdminPriorityBoardItem[];
}

export interface AdminPerformanceReviewItem {
  id: string;
  kind: "quick_win" | "declining" | "low_ctr" | "topic_opportunity" | "trend" | "memory_risk" | "agent_step";
  level: AdminPriorityLevel;
  score: number;
  title: string;
  summary: string;
  reason: string;
  actionLabel: string;
  actionType: AdminPriorityBoardItem["actionType"];
  actionHref: string | null;
  repairReason: string | null;
  articleId: string | null;
  storeId: string | null;
  store: string | null;
  article: string | null;
  locale: string | null;
  campaignDraft: AdminCampaignDraft | null;
  evidence: string[];
  metrics: AdminPriorityBoardItem["metrics"] & {
    trendPercent: number | null;
    trafficLoss: number | null;
    queryCount: number | null;
  };
  updatedAt: string;
}

export interface AdminPerformanceReviewSummary {
  quickWins: number;
  declining: number;
  lowCtr: number;
  topicOpportunities: number;
  trends: number;
  memoryRisks: number;
  stepWarnings: number;
  totalPotentialClicks: number;
}

export interface AdminPerformanceReviewView {
  organization: AdminOrganizationSummary;
  generatedAt: string;
  summary: AdminPerformanceReviewSummary;
  items: AdminPerformanceReviewItem[];
}

export type AdminResearchMode =
  | "overview"
  | "quick_wins"
  | "competitor_gaps"
  | "topic_clusters"
  | "trends"
  | "performance_matrix";

export interface AdminResearchSignal {
  id: string;
  title: string;
  subtitle: string;
  score: number;
  tone: AdminPriorityLevel;
  kind: AdminPriorityKind | "trend" | "cluster" | "gap" | "matrix";
  source: string;
  actionLabel: string;
  actionType: AdminPriorityActionType;
  actionHref: string | null;
  evidence: string[];
  metrics: Record<string, number | null>;
  relatedItems: string[];
}

export interface AdminResearchCluster {
  topic: string;
  primaryKeyword: string;
  authorityScore: number;
  authorityLevel: "Strong" | "Moderate" | "Weak" | "Minimal";
  keywordCount: number;
  totalImpressions: number;
  avgPosition: number | null;
  gapCount: number;
  topKeywords: string[];
  gapKeywords: string[];
  actionHref: string | null;
  actionLabel: string;
}

export interface AdminResearchTrend {
  keyword: string;
  growthPercent: number;
  position: number | null;
  impressions: number;
  score: number;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  urgency: string;
  searchIntent: string;
  actionHref: string | null;
}

export interface AdminResearchTopicRunAction {
  id: string;
  topicRunId: string;
  title: string;
  summary: string;
  reason: string;
  score: number;
  level: AdminPriorityLevel;
  kind: "topic_opportunity" | "topic_refresh" | "topic_gap" | "topic_cluster";
  source: string;
  actionLabel: string;
  actionType: AdminPriorityActionType;
  actionHref: string | null;
  articleId: string | null;
  campaignId: string | null;
  storeId: string | null;
  store: string | null;
  article: string | null;
  campaign: string | null;
  locale: string | null;
  evidence: string[];
  metrics: AdminPerformanceReviewItem["metrics"];
  updatedAt: string;
}

export interface AdminResearchPerformanceMatrixItem {
  title: string;
  path: string;
  category: "Star" | "Overperformer" | "Underperformer" | "Declining";
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
  trendPercent: number;
  seoScore: number | null;
  action: string;
  actionHref: string | null;
}

export interface AdminResearchView {
  organization: AdminOrganizationSummary;
  generatedAt: string;
  mode: AdminResearchMode;
  summary: {
    quickWins: number;
    competitorGaps: number;
    clusters: number;
    trends: number;
    stars: number;
    underperformers: number;
    declining: number;
    opportunities: number;
    topicRuns: number;
    searchConsoleProperties: number;
  };
  signals: AdminResearchSignal[];
  clusters: AdminResearchCluster[];
  trends: AdminResearchTrend[];
  performanceMatrix: AdminResearchPerformanceMatrixItem[];
  topicRunActions: AdminResearchTopicRunAction[];
  topicRuns: AdminPerformanceReviewItem[];
  notes: string[];
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

export interface SaveSearchConsolePropertyInput {
  id?: string;
  storeId: string;
  siteUrl: string;
  status: SearchConsolePropertyStatus;
  permissionLevel?: string;
  scopes: string[];
  googleCredentialsJson?: string;
  googleTokenJson?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export interface QueueStoreSyncInput {
  storeId: string;
  fullSync: boolean;
  products: boolean;
  collections: boolean;
  limit?: number;
}

export interface QueueSearchConsoleSyncInput {
  storeId: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  dataState?: "final" | "all";
  rowLimit?: number;
}

export interface QueueSearchConsoleArticleSyncInput {
  articleId: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  dataState?: "final" | "all";
  rowLimit?: number;
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

export interface QueueArticleRepairInput {
  articleId: string;
  repairReason?: string;
  publishAt?: string;
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
