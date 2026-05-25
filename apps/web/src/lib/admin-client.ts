import { headers } from "next/headers";
import type { ArticleStatus, CampaignStatus, JobStatus, PublishPolicy, SupportedLocale } from "@shopify-ai-blog/shared";
import type {
  AdminPriorityBoardItem,
  AdminPriorityBoardView,
  AdminDashboardQueueHealth,
  AdminPerformanceReviewItem,
  AdminPerformanceReviewView,
  AdminResearchCluster,
  AdminResearchMode,
  AdminResearchPerformanceMatrixItem,
  AdminResearchSignal,
  AdminResearchTopicRunAction,
  AdminResearchTrend,
  AdminResearchView,
  AdminArticleSeoPerformanceOverview,
  AdminSearchConsolePropertyOverview,
  AdminSearchConsoleSnapshotOverview,
  AdminSearchConsoleView
} from "@/modules/admin/contracts";

export type BadgeTone = "good" | "warn" | "danger" | "neutral";

export interface AdminFetchError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

export interface AdminFetchResult<T> {
  data: T | null;
  error: AdminFetchError | null;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: Partial<AdminFetchError>;
}

type AdminJobType =
  | "generate_article"
  | "translate_article"
  | "generate_asset"
  | "publish_article"
  | "sync_product"
  | "sync_collection"
  | "sync_search_console";

export interface AdminMetric {
  label: string;
  value: string;
  detail: string;
  tone: BadgeTone;
}

export interface AdminStoreView {
  id: string;
  name: string;
  domain: string;
  locale: string;
  status: string;
  statusTone: BadgeTone;
  products: number;
  articles: number;
  lastSync: string;
  scopes: string[];
}

export interface AdminCampaignView {
  id: string;
  name: string;
  store: string;
  locale: string;
  source: string;
  status: CampaignStatus | string;
  statusTone: BadgeTone;
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
  targetWordCount?: number;
  primaryKeyword?: string;
}

export interface AdminArticleView {
  id: string;
  title: string;
  store: string;
  storeId?: string;
  campaign?: string | null;
  locale: string;
  status: ArticleStatus | string;
  statusTone: BadgeTone;
  seoScore: number | null;
  qualityPassed?: boolean;
  updatedAt: string;
  updatedAtIso?: string;
  publishPolicy?: string;
  publishPolicyCode?: string;
  primaryKeyword?: string | null;
  failureReason?: string;
  canonicalUrl?: string | null;
  indexReadiness: AdminArticleIndexReadinessView;
}

export interface AdminArticleIndexReadinessView {
  score: number;
  label: string;
  tone: BadgeTone;
  nextStep: string;
  checks: AdminArticleIndexReadinessCheckView[];
  lastSearchConsoleSyncAt: string | null;
}

export interface AdminArticleIndexReadinessCheckView {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface AdminArticleAssetView {
  id: string;
  type: string;
  status: string;
  publicUrl: string | null;
  sourceUrl: string | null;
  altText: string | null;
  prompt: string | null;
  createdAt: string;
}

export interface AdminArticleReviewView extends AdminArticleView {
  summary: string | null;
  bodyHtml: string;
  handle: string | null;
  sourceType: string;
  sourceId: string | null;
  secondaryKeywords: string[];
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  lastGeneratedAt: string | null;
  shopifyBlogId: string | null;
  shopifyArticleId: string | null;
  qualityReport: unknown;
  generationMetadata: unknown;
  assets: AdminArticleAssetView[];
  logs: AdminLogView[];
  repairJob: AdminArticleRepairJobView | null;
  seoPerformance: AdminArticleSeoPerformanceOverview | null;
}

export interface AdminArticleRepairJobView {
  id: string;
  status: JobStatus | string;
  statusTone: BadgeTone;
  runAt: string;
  createdAt: string;
  updatedAt: string;
  message: string;
}

export interface AdminLogView {
  id: string;
  time: string;
  level: "debug" | "info" | "warn" | "warning" | "error" | string;
  levelTone: BadgeTone;
  module: string;
  message: string;
  status: JobStatus | string;
  statusTone: BadgeTone;
}

export interface AdminAiSettingsView {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  temperature: number;
  enabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  storeName?: string;
  updatedAt?: string;
}

export interface AdminLanguageView {
  id: string;
  locale: string;
  label: string;
  fallback: string;
  role: string;
  enabled: boolean;
  isDefault: boolean;
  blogHandle: string;
  storeName: string;
}

export interface AdminBrandVoiceView {
  id: string;
  name: string;
  locale: string;
  storeId: string;
  storeName: string;
  audience: string;
  tone: string;
  bannedWords: string[];
  examples: string[];
  isDefault: boolean;
}

export interface DashboardView {
  metrics: AdminMetric[];
  queueHealth: AdminDashboardQueueHealth;
  campaigns: AdminCampaignView[];
  logs: AdminLogView[];
  stores: AdminStoreView[];
  articles: AdminArticleView[];
}

export interface AdminPageView<T> {
  data: T;
  error: AdminFetchError | null;
}

async function getBaseUrl() {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const requestBaseUrl = host ? `${proto}://${host}` : null;

  if (configured) {
    return requestBaseUrl && shouldUseRequestBaseUrlForLocalDev(configured, host) ? requestBaseUrl : configured;
  }

  return requestBaseUrl ?? "http://localhost:3000";
}

function shouldUseRequestBaseUrlForLocalDev(configuredBaseUrl: string, requestHost: string | null) {
  if (!requestHost) return false;

  try {
    const configured = new URL(configuredBaseUrl);
    return isLocalHost(configured.hostname) && isLocalHost(hostnameFromHeader(requestHost)) && configured.host !== requestHost;
  } catch {
    return false;
  }
}

function hostnameFromHeader(host: string) {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0] ?? host;
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<AdminFetchResult<T>> {
  const baseUrl = await getBaseUrl();
  const url = new URL(path, baseUrl);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(init?.headers ?? {})
      }
    });

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      return {
        data: null,
        error: {
          code: readErrorCode(payload) ?? "admin_request_failed",
          message: readErrorMessage(payload) ?? `管理端接口返回 ${response.status}`,
          status: response.status,
          details: payload
        }
      };
    }

    if (isApiEnvelope<T>(payload)) {
      if (payload.ok) {
        return { data: (payload.data ?? null) as T | null, error: null };
      }

      return {
        data: null,
        error: {
          code: payload.error?.code ?? "admin_response_failed",
          message: payload.error?.message ?? "管理端接口返回失败状态",
          status: response.status,
          details: payload.error?.details
        }
      };
    }

    return { data: payload as T, error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        code: "admin_fetch_unavailable",
        message: error instanceof Error ? error.message : "管理端接口暂时不可用",
        details: error
      }
    };
  }
}

export async function getDashboardView(): Promise<AdminPageView<DashboardView>> {
  const result = await adminFetch<unknown>("/api/admin/dashboard");
  const record = asRecord(result.data);
  const stores = normalizeStores(pickCollection(record, ["stores", "shopifyStores", "recentStores"]));
  const campaigns = normalizeCampaigns(pickCollection(record, ["campaigns", "activeCampaigns", "recentCampaigns"]));
  const articles = normalizeArticles(pickCollection(record, ["articles", "pendingArticles", "recentArticles"]));
  const logs = normalizeLogs(pickCollection(record, ["logs", "events", "recentLogs"]));
  const queueHealth = normalizeQueueHealth(pickRecord(record, ["queueHealth", "queue", "workerQueue"]));

  return {
    data: {
      metrics: normalizeMetrics(pickCollection(record, ["metrics", "kpis", "summary"]), { queueHealth, stores, campaigns, articles, logs }),
      queueHealth,
      stores,
      campaigns,
      articles,
      logs
    },
    error: result.error
  };
}

export async function getStoresView(): Promise<AdminPageView<AdminStoreView[]>> {
  const result = await adminFetch<unknown>("/api/admin/stores");
  return { data: normalizeStores(unwrapCollection(result.data, ["stores", "items", "data"])), error: result.error };
}

export async function getCampaignsView(): Promise<AdminPageView<AdminCampaignView[]>> {
  const result = await adminFetch<unknown>("/api/admin/campaigns");
  return { data: normalizeCampaigns(unwrapCollection(result.data, ["campaigns", "items", "data"])), error: result.error };
}

export async function getArticlesView(): Promise<AdminPageView<AdminArticleView[]>> {
  const result = await adminFetch<unknown>("/api/admin/articles");
  return { data: normalizeArticles(unwrapCollection(result.data, ["articles", "items", "data"])), error: result.error };
}

export async function getArticleReviewView(articleId: string): Promise<AdminPageView<AdminArticleReviewView | null>> {
  const result = await adminFetch<unknown>(`/api/admin/articles/${encodeURIComponent(articleId)}`);
  const record = asRecord(result.data);
  const article = pickRecord(record, ["article", "item", "data"]);

  return {
    data: Object.keys(article).length > 0 ? normalizeArticleReview(article) : null,
    error: result.error
  };
}

export async function getLogsView(): Promise<AdminPageView<AdminLogView[]>> {
  const result = await adminFetch<unknown>("/api/admin/logs");
  return { data: normalizeLogs(unwrapCollection(result.data, ["logs", "events", "items", "data"])), error: result.error };
}

export async function getAiSettingsView(): Promise<AdminPageView<AdminAiSettingsView[]>> {
  const result = await adminFetch<unknown>("/api/admin/ai-settings");
  return { data: normalizeAiSettings(unwrapCollection(result.data, ["providers", "configs", "items", "data"])), error: result.error };
}

export async function getLanguagesView(): Promise<AdminPageView<AdminLanguageView[]>> {
  const result = await adminFetch<unknown>("/api/admin/languages");
  return { data: normalizeLanguages(unwrapCollection(result.data, ["languages", "locales", "items", "data"])), error: result.error };
}

export async function getBrandVoiceView(): Promise<AdminPageView<AdminBrandVoiceView[]>> {
  const result = await adminFetch<unknown>("/api/admin/brand-voice");
  return { data: normalizeBrandVoices(unwrapCollection(result.data, ["brandVoices", "profiles", "items", "data"])), error: result.error };
}

export async function getSearchConsoleView(): Promise<AdminPageView<AdminSearchConsoleView>> {
  const result = await adminFetch<unknown>("/api/admin/search-console");
  const record = asRecord(result.data);

  return {
    data: {
      properties: normalizeSearchConsoleProperties(unwrapCollection(record, ["properties", "items", "data"])),
      snapshots: normalizeSearchConsoleSnapshots(unwrapCollection(record, ["snapshots", "items", "data"])),
      stores: normalizeSearchConsoleStores(unwrapCollection(record, ["stores", "shopifyStores"]))
    },
    error: result.error
  };
}

export async function getPrioritiesView(): Promise<AdminPageView<AdminPriorityBoardView>> {
  const result = await adminFetch<unknown>("/api/admin/priorities");
  const record = asRecord(result.data);
  const summary = pickRecord(record, ["summary", "stats", "overview"]);

  return {
    data: {
      organization: pickOrganization(record),
      generatedAt: pickString(record, ["generatedAt", "createdAt"], new Date().toISOString()),
      summary: {
        quickWins: pickNumber(summary, ["quickWins", "quick_win", "quickWinsCount"], 0),
        declining: pickNumber(summary, ["declining"], 0),
        lowCtr: pickNumber(summary, ["lowCtr", "low_ctr"], 0),
        topicOpportunities: pickNumber(summary, ["topicOpportunities", "topic_opportunities"], 0),
        reflectionTasks: pickNumber(summary, ["reflectionTasks", "reflection_tasks"], 0),
        stepWarnings: pickNumber(summary, ["stepWarnings", "step_warnings"], 0),
        memoryRisks: pickNumber(summary, ["memoryRisks", "memory_risks"], 0),
        potentialClickGain: pickNumber(summary, ["potentialClickGain", "potential_click_gain"], 0)
      },
      items: normalizePriorityItems(unwrapCollection(record, ["items", "opportunities", "data"]))
    },
    error: result.error
  };
}

export async function getPerformanceReviewView(): Promise<AdminPageView<AdminPerformanceReviewView>> {
  const result = await adminFetch<unknown>("/api/admin/performance-review");
  const record = asRecord(result.data);
  const summary = pickRecord(record, ["summary", "stats", "overview"]);

  return {
    data: {
      organization: pickOrganization(record),
      generatedAt: pickString(record, ["generatedAt", "createdAt"], new Date().toISOString()),
      summary: {
        quickWins: pickNumber(summary, ["quickWins", "quick_win"], 0),
        declining: pickNumber(summary, ["declining"], 0),
        lowCtr: pickNumber(summary, ["lowCtr", "low_ctr"], 0),
        topicOpportunities: pickNumber(summary, ["topicOpportunities", "topic_opportunities"], 0),
        trends: pickNumber(summary, ["trends", "trend"], 0),
        memoryRisks: pickNumber(summary, ["memoryRisks", "memory_risks"], 0),
        stepWarnings: pickNumber(summary, ["stepWarnings", "step_warnings"], 0),
        totalPotentialClicks: pickNumber(summary, ["totalPotentialClicks", "potentialClickGain", "total_potential_clicks"], 0)
      },
      items: normalizePerformanceReviewItems(unwrapCollection(record, ["items", "opportunities", "data"]))
    },
    error: result.error
  };
}

export async function getResearchView(mode?: AdminResearchMode): Promise<AdminPageView<AdminResearchView>> {
  const activeMode = mode ?? "overview";
  const path = `/api/admin/research?mode=${encodeURIComponent(activeMode)}`;
  const result = await adminFetch<unknown>(path);
  const record = asRecord(result.data);
  const summary = pickRecord(record, ["summary", "stats", "overview"]);

  if (Object.keys(record).length === 0) {
    const [priorities, performance, searchConsole] = await Promise.all([
      getPrioritiesView(),
      getPerformanceReviewView(),
      getSearchConsoleView()
    ]);

    return {
      data: buildResearchViewFromAdminViews(activeMode, priorities.data, performance.data, searchConsole.data),
      error: priorities.error ?? performance.error ?? searchConsole.error ?? (result.error?.status === 404 ? null : result.error)
    };
  }

  return {
    data: {
      organization: pickOrganization(record),
      generatedAt: pickString(record, ["generatedAt", "createdAt"], new Date().toISOString()),
      mode: normalizeResearchMode(pickString(record, ["mode"], activeMode)),
      summary: {
        quickWins: pickNumber(summary, ["quickWins", "quick_win"], 0),
        competitorGaps: pickNumber(summary, ["competitorGaps", "competitor_gaps"], 0),
        clusters: pickNumber(summary, ["clusters"], 0),
        trends: pickNumber(summary, ["trends", "trend"], 0),
        stars: pickNumber(summary, ["stars"], 0),
        underperformers: pickNumber(summary, ["underperformers"], 0),
        declining: pickNumber(summary, ["declining"], 0),
        opportunities: pickNumber(summary, ["opportunities"], 0),
        topicRuns: pickNumber(summary, ["topicRuns", "topic_runs"], 0),
        searchConsoleProperties: pickNumber(summary, ["searchConsoleProperties", "search_console_properties"], 0)
      },
      signals: normalizeResearchSignals(unwrapCollection(record, ["signals", "items", "data"])),
      clusters: normalizeResearchClusters(unwrapCollection(record, ["clusters", "topicClusters", "data"])),
      trends: normalizeResearchTrends(unwrapCollection(record, ["trends", "trendSignals", "data"])),
      performanceMatrix: normalizeResearchPerformanceMatrix(unwrapCollection(record, ["performanceMatrix", "matrix", "data"])),
      topicRunActions: normalizeResearchTopicRunActions(
        unwrapCollection(record, ["topicRunActions", "actions", "data"]),
        unwrapCollection(record, ["topicRuns", "items", "data"])
      ),
      topicRuns: normalizePerformanceReviewItems(unwrapCollection(record, ["topicRuns", "items", "data"])),
      notes: pickStringArray(record, ["notes", "highlights", "recommendations"])
    },
    error: result.error
  };
}

function readErrorCode(payload: unknown) {
  const record = asRecord(payload);
  const nested = asRecord(record.error);
  return pickString(nested, ["code"]) ?? pickString(record, ["code"]);
}

function readErrorMessage(payload: unknown) {
  const record = asRecord(payload);
  const nested = asRecord(record.error);
  return pickString(nested, ["message"]) ?? pickString(record, ["message", "error"]);
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return Boolean(value && typeof value === "object" && "ok" in value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function unwrapCollection(value: unknown, keys: string[]) {
  if (Array.isArray(value)) return value;
  return pickCollection(asRecord(value), keys);
}

function pickCollection(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function pickRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (Object.keys(value).length > 0) return value;
  }
  return {};
}

function pickString(record: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return fallback;
}

function pickNumber(record: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return fallback;
}

function pickNullableNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function pickBoolean(record: Record<string, unknown>, keys: string[], fallback = false) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value === "true") return true;
      if (value === "false") return false;
    }
  }
  return fallback;
}

function pickStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function normalizeMetrics(input: unknown[], fallback: Omit<DashboardView, "metrics">): AdminMetric[] {
  const metrics = input.map((item, index) => {
    const record = asRecord(item);
    return {
      label: pickString(record, ["label", "name", "title"], `指标 ${index + 1}`),
      value: pickString(record, ["value", "count", "total"], "0"),
      detail: pickString(record, ["detail", "description", "helperText"], "实时管理端数据"),
      tone: normalizeTone(pickString(record, ["tone", "status", "level"], "neutral"))
    };
  });

  if (metrics.length > 0) return metrics;

  const failedLogs = fallback.logs.filter((log) => log.statusTone === "danger" || log.levelTone === "danger").length;
  const pendingArticles = fallback.articles.filter((article) => article.status !== "published").length;

  return [
    {
      label: "已连接店铺",
      value: String(fallback.stores.length),
      detail: "来自管理端店铺接口",
      tone: fallback.stores.length > 0 ? "good" : "neutral"
    },
    {
      label: "活跃任务",
      value: String(fallback.campaigns.filter((campaign) => campaign.status === "active").length),
      detail: `${fallback.campaigns.length} 个任务记录`,
      tone: "good"
    },
    {
      label: "待处理文章",
      value: String(pendingArticles),
      detail: "草稿、待发布或失败状态",
      tone: pendingArticles > 0 ? "warn" : "good"
    },
    {
      label: "异常事件",
      value: String(failedLogs),
      detail: "最近日志中的失败或错误",
      tone: failedLogs > 0 ? "danger" : "good"
    }
  ];
}

function normalizeQueueHealth(record: Record<string, unknown>): AdminDashboardQueueHealth {
  const queuedJobs = pickNumber(record, ["queuedJobs", "queued", "pendingQueuedJobs"], 0);
  const runningJobs = pickNumber(record, ["runningJobs", "running"], 0);
  const retryingJobs = pickNumber(record, ["retryingJobs", "retrying"], 0);
  const failedJobs = pickNumber(record, ["failedJobs", "failed"], 0);
  const activeJobs = pickNumber(record, ["activeJobs"], runningJobs + retryingJobs);
  const pendingJobs = pickNumber(record, ["pendingJobs"], queuedJobs + activeJobs);
  const tone = normalizeTone(pickString(record, ["tone", "status", "level"], failedJobs > 0 ? "danger" : activeJobs > 0 || queuedJobs > 0 ? "warn" : "good"));

  return {
    queuedJobs,
    runningJobs,
    retryingJobs,
    failedJobs,
    activeJobs,
    pendingJobs,
    tone,
    label: pickString(record, ["label", "title"], failedJobs > 0 ? "有失败任务" : activeJobs > 0 ? "任务正在执行" : queuedJobs > 0 ? "任务已排队" : "队列空闲"),
    nextStep: pickString(
      record,
      ["nextStep", "detail"],
      failedJobs > 0
        ? "先看失败原因，再重新排队或修复文章。"
        : activeJobs > 0
          ? "等待 worker 继续执行，必要时去文章页看最新状态。"
          : queuedJobs > 0
            ? "worker 正在取队列，先看文章和日志是否有更新。"
            : "可以直接开始新任务。"
    ),
    lastFailedJobId: pickString(record, ["lastFailedJobId"], "") || null,
    lastFailedJobType: normalizeJobType(pickString(record, ["lastFailedJobType"], "")),
    lastFailedAt: pickString(record, ["lastFailedAt"], "") || null,
    lastFailedMessage: pickString(record, ["lastFailedMessage"], "") || null
  };
}

function normalizeStores(input: unknown[]): AdminStoreView[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const status = pickString(record, ["status", "connectionStatus"], "unknown");
    const store = pickRecord(record, ["store", "shopifyStore"]);

    return {
      id: pickString(record, ["id", "storeId"], pickString(store, ["id"], `store-${index}`)),
      name: pickString(record, ["name", "shopName"], pickString(store, ["name"], "未命名店铺")),
      domain: pickString(
        record,
        ["domain", "myshopifyDomain", "shopDomain"],
        pickString(store, ["domain", "myshopifyDomain", "shopDomain"], "-")
      ),
      locale: pickString(record, ["locale", "primaryLocale", "defaultLocale"], pickString(store, ["primaryLocale"], "zh-CN")),
      status: normalizeStoreStatus(status),
      statusTone: storeTone(status),
      products: pickNumber(record, ["products", "productCount", "productsCount"], pickNumber(record, ["_count.products"], 0)),
      articles: pickNumber(record, ["articles", "articleCount", "articlesCount"], pickNumber(record, ["_count.articles"], 0)),
      lastSync: formatDate(pickString(record, ["lastSync", "lastSyncedAt", "syncedAt"], pickString(store, ["lastSyncedAt"], ""))),
      scopes: pickStringArray(record, ["scopes"])
    };
  });
}

function normalizeCampaigns(input: unknown[]): AdminCampaignView[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const store = pickRecord(record, ["store", "shopifyStore"]);
    const status = pickString(record, ["status"], "draft");
    const generated = pickNumber(record, ["generatedArticles", "completedArticles", "doneCount"], 0);
    const total = pickNumber(record, ["targetArticles", "totalArticles", "articleCount"], 0);

    return {
      id: pickString(record, ["id", "campaignId"], `campaign-${index}`),
      name: pickString(record, ["name", "title"], "未命名任务"),
      store: pickString(record, ["storeName", "store"], pickString(store, ["name", "myshopifyDomain"], "未绑定店铺")),
      locale: pickString(record, ["locale"], "zh-CN"),
      source: formatSource(record),
      status,
      statusTone: campaignTone(status),
      progress: clampPercent(pickNumber(record, ["progress", "progressPercent"], total > 0 ? (generated / total) * 100 : 0)),
      progressLabel: pickString(record, ["progressLabel", "stageLabel"], status === "active" ? "正在执行" : "未开始"),
      progressStep: pickString(record, ["progressStep", "stage"], "") || null,
      progressDetail: pickString(record, ["progressDetail", "detail"], "") || null,
      progressUpdatedAt: pickString(record, ["progressUpdatedAt"], "") || null,
      progressStage: pickString(record, ["progressStage"], "") || null,
      progressNextStep: pickString(record, ["progressNextStep"], "") || null,
      progressRecoverable: pickBoolean(record, ["progressRecoverable"], false),
      progressArticleId: pickString(record, ["progressArticleId"], "") || null,
      progressIsStale: pickBoolean(record, ["progressIsStale"], false),
      progressStaleMinutes: normalizeNullableNumber(record, ["progressStaleMinutes"]),
      progressStaleReason: pickString(record, ["progressStaleReason"], "") || null,
      publishPolicy: formatPublishPolicy(pickString(record, ["publishPolicy"], "manual_review")),
      targetWordCount: pickNumber(record, ["targetWordCount"], 0),
      primaryKeyword: pickString(record, ["primaryKeyword"], "")
    };
  });
}

function normalizeArticles(input: unknown[]): AdminArticleView[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const store = pickRecord(record, ["store", "shopifyStore"]);
    const status = pickString(record, ["status"], "draft");

    return {
      id: pickString(record, ["id", "articleId"], `article-${index}`),
      title: pickString(record, ["title", "seoTitle"], "未命名文章"),
      store: pickString(record, ["storeName", "store"], pickString(store, ["name", "myshopifyDomain"], "未绑定店铺")),
      storeId: pickString(record, ["storeId"], ""),
      campaign: pickString(record, ["campaign"], "") || null,
      locale: pickString(record, ["locale"], "zh-CN"),
      status,
      statusTone: articleTone(status),
      seoScore: normalizeNullableNumber(record, ["seoScore", "qualityScore"]),
      qualityPassed: pickBoolean(record, ["qualityPassed"], false),
      updatedAt: formatDate(pickString(record, ["updatedAt", "lastGeneratedAt", "createdAt"], "")),
      updatedAtIso: pickString(record, ["updatedAtIso", "updatedAt"], ""),
      publishPolicy: formatPublishPolicy(pickString(record, ["publishPolicy"], "")),
      publishPolicyCode: pickString(record, ["publishPolicy"], ""),
      primaryKeyword: pickString(record, ["primaryKeyword"], "") || null,
      failureReason: pickString(record, ["failureReason", "errorMessage"], ""),
      canonicalUrl: pickString(record, ["canonicalUrl"], "") || null,
      indexReadiness: normalizeIndexReadiness(record, status)
    };
  });
}

function normalizeIndexReadiness(record: Record<string, unknown>, status: string): AdminArticleIndexReadinessView {
  const readiness = asRecord(record.indexReadiness);
  const checks = unwrapCollection(readiness.checks, ["checks", "items"]).map((item) => {
    const check = asRecord(item);
    return {
      key: pickString(check, ["key"], ""),
      label: pickString(check, ["label"], "检查项"),
      passed: pickBoolean(check, ["passed"], false),
      detail: pickString(check, ["detail"], "")
    };
  });
  const canonicalUrl = pickString(record, ["canonicalUrl"], "");
  const qualityPassed = pickBoolean(record, ["qualityPassed"], false);
  const seoScore = normalizeNullableNumber(record, ["seoScore", "qualityScore"]) ?? 0;
  const fallbackChecks =
    checks.length > 0
      ? checks
      : [
          {
            key: "content_quality",
            label: "内容过线",
            passed: qualityPassed && seoScore >= 82,
            detail: qualityPassed ? `SEO ${Math.round(seoScore)}，内容质量已通过。` : "内容还没有通过质量门禁。"
          },
          {
            key: "published_url",
            label: "已上线",
            passed: status === "published",
            detail: status === "published" ? "已发布到线上店铺。" : "文章还没有发布到线上店铺。"
          },
          {
            key: "canonical_url",
            label: "Canonical",
            passed: Boolean(canonicalUrl),
            detail: canonicalUrl ? "线上规范 URL 已保存。" : "发布成功后系统会保存 canonical URL。"
          },
          {
            key: "search_console",
            label: "搜索同步",
            passed: false,
            detail: "发布后同步 Search Console，继续看抓取和表现。"
          }
        ];
  const passedCount = fallbackChecks.filter((check) => check.passed).length;
  const fallbackScore = Math.round((passedCount / fallbackChecks.length) * 100);
  const score = pickNumber(readiness, ["score"], fallbackScore);
  const label = pickString(
    readiness,
    ["label"],
    status === "published" ? (canonicalUrl ? "可被发现" : "待确认链接") : status === "ready_to_publish" ? "待发布" : "先修复内容"
  );
  const nextStep = pickString(
    readiness,
    ["nextStep"],
    status === "published" ? "同步 Search Console，继续看抓取和表现。" : "发布到 Shopify 后，Google 才能抓取线上页面。"
  );

  return {
    score,
    label,
    tone: normalizeTone(pickString(readiness, ["tone"], status === "published" ? "good" : status === "ready_to_publish" ? "warn" : "neutral")),
    nextStep,
    checks: fallbackChecks,
    lastSearchConsoleSyncAt: pickString(readiness, ["lastSearchConsoleSyncAt"], "") || null
  };
}

function normalizeArticleReview(record: Record<string, unknown>): AdminArticleReviewView {
  const base = normalizeArticles([record])[0];

  return {
    ...base,
    handle: pickString(record, ["handle"], "") || null,
    summary: pickString(record, ["summary"], "") || null,
    bodyHtml: pickString(record, ["bodyHtml"], ""),
    sourceType: pickString(record, ["sourceType"], "manual_topic"),
    sourceId: pickString(record, ["sourceId"], "") || null,
    secondaryKeywords: pickStringArray(record, ["secondaryKeywords"]),
    tags: pickStringArray(record, ["tags"]),
    seoTitle: pickString(record, ["seoTitle"], "") || null,
    seoDescription: pickString(record, ["seoDescription"], "") || null,
    publishedAt: pickString(record, ["publishedAt"], "") || null,
    scheduledAt: pickString(record, ["scheduledAt"], "") || null,
    lastGeneratedAt: pickString(record, ["lastGeneratedAt"], "") || null,
    shopifyBlogId: pickString(record, ["shopifyBlogId"], "") || null,
    shopifyArticleId: pickString(record, ["shopifyArticleId"], "") || null,
    qualityReport: record.qualityReport ?? null,
    generationMetadata: record.generationMetadata ?? null,
    assets: normalizeArticleAssets(unwrapCollection(record.assets, ["assets", "items", "data"])),
    logs: normalizeLogs(unwrapCollection(record.logs, ["logs", "items", "data"])),
    repairJob: normalizeArticleRepairJob(record.repairJob),
    seoPerformance: normalizeArticleSeoPerformance(record.seoPerformance)
  };
}

function normalizeArticleSeoPerformance(value: unknown): AdminArticleSeoPerformanceOverview | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const queries: AdminArticleSeoPerformanceOverview["queries"] = unwrapCollection(record.queries, ["queries", "items", "data"]).map((item) => {
    const query = asRecord(item);
    const opportunity = pickString(query, ["opportunity"], "observe");
    return {
      query: pickString(query, ["query"], ""),
      clicks: pickNumber(query, ["clicks"], 0),
      impressions: pickNumber(query, ["impressions"], 0),
      ctr: pickNumber(query, ["ctr"], 0),
      position: pickNullableNumber(query, ["position"]),
      opportunity: opportunity === "quick_win" || opportunity === "low_ctr" ? opportunity : "observe"
    };
  });

  return {
    snapshotId: pickString(record, ["snapshotId", "id"], ""),
    propertyId: pickString(record, ["propertyId"], ""),
    siteUrl: pickString(record, ["siteUrl"], ""),
    pageUrl: pickString(record, ["pageUrl"], ""),
    startDate: pickString(record, ["startDate"], ""),
    endDate: pickString(record, ["endDate"], ""),
    dataState: pickString(record, ["dataState"], "final"),
    clicks: pickNumber(record, ["clicks"], 0),
    impressions: pickNumber(record, ["impressions"], 0),
    ctr: pickNumber(record, ["ctr"], 0),
    position: pickNullableNumber(record, ["position"]),
    queryCount: pickNumber(record, ["queryCount"], queries.length),
    topQuery: pickString(record, ["topQuery"], "") || null,
    performanceScore: pickNullableNumber(record, ["performanceScore"]),
    syncedAt: pickString(record, ["syncedAt"], ""),
    queries,
    recommendations: pickStringArray(record, ["recommendations"])
  };
}

function normalizeArticleRepairJob(value: unknown): AdminArticleRepairJobView | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const status = pickString(record, ["status"], "queued");

  return {
    id: pickString(record, ["id"], ""),
    status,
    statusTone: jobTone(status),
    runAt: pickString(record, ["runAt"], ""),
    createdAt: pickString(record, ["createdAt"], ""),
    updatedAt: pickString(record, ["updatedAt"], ""),
    message: pickString(record, ["message"], "AI 修复任务已排队")
  };
}

function normalizeArticleAssets(input: unknown[]): AdminArticleAssetView[] {
  return input.map((item, index) => {
    const record = asRecord(item);

    return {
      id: pickString(record, ["id"], `asset-${index}`),
      type: pickString(record, ["type"], "image"),
      status: pickString(record, ["status"], "unknown"),
      publicUrl: pickString(record, ["publicUrl"], "") || null,
      sourceUrl: pickString(record, ["sourceUrl"], "") || null,
      altText: pickString(record, ["altText"], "") || null,
      prompt: pickString(record, ["prompt"], "") || null,
      createdAt: pickString(record, ["createdAt"], "")
    };
  });
}

function normalizeLogs(input: unknown[]): AdminLogView[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const level = pickString(record, ["level", "severity"], "info");
    const status = pickString(record, ["status", "event"], level === "error" ? "failed" : "succeeded");

    return {
      id: pickString(record, ["id", "logId"], `log-${index}`),
      time: formatDate(pickString(record, ["time", "createdAt", "updatedAt"], "")),
      level,
      levelTone: logTone(level),
      module: pickString(record, ["module", "entityType", "source"], "system"),
      message: pickString(record, ["message", "description"], "无日志消息"),
      status,
      statusTone: jobTone(status)
    };
  });
}

function normalizeAiSettings(input: unknown[]): AdminAiSettingsView[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const store = pickRecord(record, ["store", "shopifyStore"]);

    return {
      id: pickString(record, ["id", "configId"], `ai-${index}`),
      name: pickString(record, ["name", "slug"], "默认 Provider"),
      provider: pickString(record, ["provider"], "openai"),
      baseUrl: pickString(record, ["baseUrl"], ""),
      textModel: pickString(record, ["textModel", "model"], ""),
      imageModel: pickString(record, ["imageModel"], ""),
      temperature: pickNumber(record, ["temperature"], 0.8),
      enabled: pickBoolean(record, ["enabled", "isEnabled"], true),
      isDefault: pickBoolean(record, ["isDefault", "default"], false),
      hasApiKey: pickBoolean(record, ["hasApiKey"], Boolean(pickString(record, ["apiKeyMasked", "maskedApiKey"], ""))),
      apiKeyMasked: pickString(record, ["apiKeyMasked", "maskedApiKey"], ""),
      storeName: pickString(record, ["storeName"], pickString(store, ["name"], "")),
      updatedAt: formatDate(pickString(record, ["updatedAt"], ""))
    };
  });
}

function normalizeLanguages(input: unknown[]): AdminLanguageView[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const store = pickRecord(record, ["store", "shopifyStore"]);
    const locale = pickString(record, ["locale"], "zh-CN");

    return {
      id: pickString(record, ["id", "localeConfigId"], `language-${index}`),
      locale,
      label: pickString(record, ["label", "name"], locale),
      fallback: pickString(record, ["fallback", "fallbackLocale"], "zh-CN"),
      role: pickString(record, ["role", "description"], pickBoolean(record, ["isDefault"], false) ? "默认内容语言" : "内容生成语言"),
      enabled: pickBoolean(record, ["enabled", "isEnabled"], true),
      isDefault: pickBoolean(record, ["isDefault", "default"], false),
      blogHandle: pickString(record, ["shopifyBlogHandle", "blogHandle"], "-"),
      storeName: pickString(record, ["storeName"], pickString(store, ["name"], "全局"))
    };
  });
}

function normalizeBrandVoices(input: unknown[]): AdminBrandVoiceView[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const store = pickRecord(record, ["store", "shopifyStore"]);

    return {
      id: pickString(record, ["id", "brandVoiceId"], `brand-voice-${index}`),
      name: pickString(record, ["name"], "默认品牌语气"),
      locale: pickString(record, ["locale"], "zh-CN"),
      storeId: pickString(record, ["storeId"], ""),
      storeName: pickString(record, ["storeName"], pickString(store, ["name"], "全局")),
      audience: pickString(record, ["audience"], "未配置受众"),
      tone: pickString(record, ["tone"], "未配置语调"),
      bannedWords: pickStringArray(record, ["bannedWords", "blockedWords"]),
      examples: pickStringArray(record, ["examples", "sampleRules"]),
      isDefault: pickBoolean(record, ["isDefault", "default"], false)
    };
  });
}

function normalizeSearchConsoleProperties(input: unknown[]): AdminSearchConsolePropertyOverview[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const store = pickRecord(record, ["store", "shopifyStore"]);
    const storeName = pickString(record, ["storeName", "store"], pickString(store, ["name"], "未绑定店铺"));
    const publishedSiteUrl = pickString(
      record,
      ["publishedSiteUrl", "siteUrl", "storePublishedSiteUrl"],
      ""
    );

    return {
      id: pickString(record, ["id", "propertyId"], `search-console-property-${index}`),
      storeId: pickString(record, ["storeId"], pickString(store, ["id"], "")),
      store: storeName,
      publishedSiteUrl,
      siteUrl: pickString(record, ["siteUrl"], ""),
      status: normalizeSearchConsoleStatus(pickString(record, ["status"], "active")),
      statusTone: normalizeTone(pickString(record, ["statusTone"], pickString(record, ["status"], "neutral"))),
      permissionLevel: pickString(record, ["permissionLevel"], "") || null,
      scopes: pickStringArray(record, ["scopes"]),
      hasOAuthClient: pickBoolean(record, ["hasOAuthClient"], Boolean(pickString(record, ["googleClientId"], ""))),
      hasClientSecret: pickBoolean(record, ["hasClientSecret"], false),
      hasRefreshToken: pickBoolean(record, ["hasRefreshToken"], false),
      snapshotCount: pickNumber(record, ["snapshotCount", "_count.snapshots"], 0),
      queryRowCount: pickNumber(record, ["queryRowCount", "_count.queryRows"], 0),
      lastSyncedAt: formatIsoDate(pickString(record, ["lastSyncedAt"], "")),
      lastSyncError: pickString(record, ["lastSyncError"], "") || null,
      createdAt: formatRequiredIsoDate(pickString(record, ["createdAt"], "")),
      updatedAt: formatRequiredIsoDate(pickString(record, ["updatedAt"], ""))
    };
  });
}

function normalizeSearchConsoleStores(input: unknown[]): AdminSearchConsoleView["stores"] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const domain = pickString(record, ["domain", "myshopifyDomain"], "");
    const publishedSiteUrl = pickString(record, ["publishedSiteUrl"], pickString(record, ["defaultSiteUrl"], ""));

    return {
      id: pickString(record, ["id", "storeId"], `search-console-store-${index}`),
      name: pickString(record, ["name", "storeName"], domain || "未命名店铺"),
      domain,
      publishedSiteUrl,
      defaultSiteUrl: pickString(
        record,
        ["defaultSiteUrl", "siteUrl"],
        publishedSiteUrl ? `${publishedSiteUrl.replace(/\/+$/g, "")}/` : domain ? `https://${domain}/` : ""
      )
    };
  });
}

function normalizeSearchConsoleSnapshots(input: unknown[]): AdminSearchConsoleSnapshotOverview[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const store = pickRecord(record, ["store", "shopifyStore"]);
    const article = pickRecord(record, ["article", "blogArticle"]);
    const property = pickRecord(record, ["property", "searchConsoleProperty"]);
    const storeName = pickString(record, ["storeName", "store"], pickString(store, ["name"], "未绑定店铺"));

    return {
      id: pickString(record, ["id", "snapshotId"], `search-console-snapshot-${index}`),
      propertyId: pickString(record, ["propertyId"], pickString(property, ["id"], "")),
      storeId: pickString(record, ["storeId"], pickString(store, ["id"], "")),
      store: storeName,
      articleId: pickString(record, ["articleId"], pickString(article, ["id"], "")),
      article: pickString(record, ["articleTitle"], pickString(article, ["title"], "未命名文章")),
      siteUrl: pickString(record, ["siteUrl"], pickString(property, ["siteUrl"], "")),
      pageUrl: pickString(record, ["pageUrl"], ""),
      startDate: formatDateOnly(pickString(record, ["startDate"], "")),
      endDate: formatDateOnly(pickString(record, ["endDate"], "")),
      dataState: pickString(record, ["dataState"], "final"),
      clicks: pickNumber(record, ["clicks"], 0),
      impressions: pickNumber(record, ["impressions"], 0),
      ctr: pickNumber(record, ["ctr"], 0),
      position: normalizeNullableNumber(record, ["position"]),
      queryCount: pickNumber(record, ["queryCount"], 0),
      topQuery: pickString(record, ["topQuery"], "") || null,
      performanceScore: normalizeNullableNumber(record, ["performanceScore"]),
      syncedAt: formatRequiredIsoDate(pickString(record, ["syncedAt"], "")),
      source: pickString(record, ["source"], "google_search_console")
    };
  });
}

function normalizePriorityItems(input: unknown[]): AdminPriorityBoardItem[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const metrics = asRecord(record.metrics);

    return {
      id: pickString(record, ["id"], `priority-${index}`),
      kind: normalizePriorityKind(pickString(record, ["kind"], "quick_win")),
      level: normalizePriorityLevel(pickString(record, ["level"], "medium")),
      score: clampPercent(pickNumber(record, ["score"], 0)),
      title: pickString(record, ["title"], "未命名机会"),
      summary: pickString(record, ["summary"], "暂无摘要"),
      reason: pickString(record, ["reason"], "暂无原因"),
      actionLabel: pickString(record, ["actionLabel", "action"], "查看"),
      actionType: normalizePriorityActionType(pickString(record, ["actionType"], "view_run")),
      actionHref: pickString(record, ["actionHref"], "") || null,
      repairReason: pickString(record, ["repairReason", "repair_reason"], "") || null,
      articleId: pickString(record, ["articleId"], "") || null,
      campaignId: pickString(record, ["campaignId"], "") || null,
      topicRunId: pickString(record, ["topicRunId"], "") || null,
      storeId: pickString(record, ["storeId"], "") || null,
      store: pickString(record, ["store"], "") || null,
      article: pickString(record, ["article"], "") || null,
      campaign: pickString(record, ["campaign"], "") || null,
      locale: pickString(record, ["locale"], "") || null,
      campaignDraft: normalizeCampaignDraft(record),
      evidence: pickStringArray(record, ["evidence"]),
      metrics: {
        clicks: normalizeNullableNumber(metrics, ["clicks"]),
        impressions: normalizeNullableNumber(metrics, ["impressions"]),
        ctr: normalizeNullableNumber(metrics, ["ctr"]),
        position: normalizeNullableNumber(metrics, ["position"]),
        performanceScore: normalizeNullableNumber(metrics, ["performanceScore", "performance_score"]),
        changePercent: normalizeNullableNumber(metrics, ["changePercent", "change_percent"]),
        opportunityScore: normalizeNullableNumber(metrics, ["opportunityScore", "opportunity_score"]),
        memoryRisk: normalizeNullableNumber(metrics, ["memoryRisk", "memory_risk"]),
        potentialClicks: normalizeNullableNumber(metrics, ["potentialClicks", "potential_clicks"])
      },
      updatedAt: formatRequiredIsoDate(pickString(record, ["updatedAt"], ""))
    };
  });
}

function normalizePerformanceReviewItems(input: unknown[]): AdminPerformanceReviewItem[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const metrics = asRecord(record.metrics);

    return {
      id: pickString(record, ["id"], `performance-review-${index}`),
      kind: normalizePerformanceReviewKind(pickString(record, ["kind"], "quick_win")),
      level: normalizePriorityLevel(pickString(record, ["level"], "medium")),
      score: clampPercent(pickNumber(record, ["score"], 0)),
      title: pickString(record, ["title"], "未命名机会"),
      summary: pickString(record, ["summary"], "暂无摘要"),
      reason: pickString(record, ["reason"], "暂无原因"),
      actionLabel: pickString(record, ["actionLabel", "action"], "查看"),
      actionType: normalizePriorityActionType(pickString(record, ["actionType"], "view_run")),
      actionHref: pickString(record, ["actionHref"], "") || null,
      repairReason: pickString(record, ["repairReason", "repair_reason"], "") || null,
      articleId: pickString(record, ["articleId"], "") || null,
      storeId: pickString(record, ["storeId"], "") || null,
      store: pickString(record, ["store"], "") || null,
      article: pickString(record, ["article"], "") || null,
      locale: pickString(record, ["locale"], "") || null,
      campaignDraft: normalizeCampaignDraft(record),
      evidence: pickStringArray(record, ["evidence"]),
      metrics: {
        clicks: normalizeNullableNumber(metrics, ["clicks"]),
        impressions: normalizeNullableNumber(metrics, ["impressions"]),
        ctr: normalizeNullableNumber(metrics, ["ctr"]),
        position: normalizeNullableNumber(metrics, ["position"]),
        performanceScore: normalizeNullableNumber(metrics, ["performanceScore", "performance_score"]),
        changePercent: normalizeNullableNumber(metrics, ["changePercent", "change_percent"]),
        opportunityScore: normalizeNullableNumber(metrics, ["opportunityScore", "opportunity_score"]),
        memoryRisk: normalizeNullableNumber(metrics, ["memoryRisk", "memory_risk"]),
        potentialClicks: normalizeNullableNumber(metrics, ["potentialClicks", "potential_clicks"]),
        trendPercent: normalizeNullableNumber(metrics, ["trendPercent", "trend_percent"]),
        trafficLoss: normalizeNullableNumber(metrics, ["trafficLoss", "traffic_loss"]),
        queryCount: normalizeNullableNumber(metrics, ["queryCount", "query_count"])
      },
      updatedAt: formatRequiredIsoDate(pickString(record, ["updatedAt"], ""))
    };
  });
}

function normalizeResearchSignals(input: unknown[]): AdminResearchSignal[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const metrics = asRecord(record.metrics);

    return {
      id: pickString(record, ["id"], `research-signal-${index}`),
      title: pickString(record, ["title", "name"], "未命名研究信号"),
      subtitle: pickString(record, ["subtitle", "summary", "reason"], "暂无摘要"),
      score: clampPercent(pickNumber(record, ["score"], 0)),
      tone: normalizePriorityLevel(pickString(record, ["tone", "level", "priority"], "medium").toLowerCase()),
      kind: normalizeResearchKind(pickString(record, ["kind", "type"], "quick_win")),
      source: pickString(record, ["source"], "admin_research"),
      actionLabel: pickString(record, ["actionLabel", "action"], "查看"),
      actionType: normalizePriorityActionType(pickString(record, ["actionType"], "view_run")),
      actionHref: pickString(record, ["actionHref", "href", "url"], "") || null,
      evidence: pickStringArray(record, ["evidence", "signals"]),
      metrics: {
        clicks: normalizeNullableNumber(metrics, ["clicks"]),
        impressions: normalizeNullableNumber(metrics, ["impressions"]),
        ctr: normalizeNullableNumber(metrics, ["ctr"]),
        position: normalizeNullableNumber(metrics, ["position", "avgPosition"]),
        potentialClicks: normalizeNullableNumber(metrics, ["potentialClicks", "potential_clicks"]),
        trendPercent: normalizeNullableNumber(metrics, ["trendPercent", "trend_percent"]),
        gapScore: normalizeNullableNumber(metrics, ["gapScore", "gap_score"]),
        opportunityScore: normalizeNullableNumber(metrics, ["opportunityScore", "opportunity_score"])
      },
      relatedItems: pickStringArray(record, ["relatedItems", "related", "keywords"])
    };
  });
}

function normalizeResearchClusters(input: unknown[]): AdminResearchCluster[] {
  return input.map((item, index) => {
    const record = asRecord(item);
    const authorityScore = clampPercent(pickNumber(record, ["authorityScore", "score"], 0));

    return {
      topic: pickString(record, ["topic", "title"], `主题集群 ${index + 1}`),
      primaryKeyword: pickString(record, ["primaryKeyword", "keyword"], "未设置关键词"),
      authorityScore,
      authorityLevel: normalizeAuthorityLevel(pickString(record, ["authorityLevel"], authorityLevelForScore(authorityScore))),
      keywordCount: pickNumber(record, ["keywordCount", "keywords"], 0),
      totalImpressions: pickNumber(record, ["totalImpressions", "impressions"], 0),
      avgPosition: normalizeNullableNumber(record, ["avgPosition", "position"]),
      gapCount: pickNumber(record, ["gapCount", "gaps"], 0),
      topKeywords: pickStringArray(record, ["topKeywords", "keywords"]),
      gapKeywords: pickStringArray(record, ["gapKeywords", "missingKeywords"]),
      actionHref: pickString(record, ["actionHref", "href"], "") || null,
      actionLabel: pickString(record, ["actionLabel", "action"], "创建内容任务")
    };
  });
}

function normalizeResearchTrends(input: unknown[]): AdminResearchTrend[] {
  return input.map((item, index) => {
    const record = asRecord(item);

    return {
      keyword: pickString(record, ["keyword", "query", "title"], `趋势 ${index + 1}`),
      growthPercent: pickNumber(record, ["growthPercent", "trendPercent", "changePercent"], 0),
      position: normalizeNullableNumber(record, ["position", "avgPosition"]),
      impressions: pickNumber(record, ["impressions"], 0),
      score: clampPercent(pickNumber(record, ["score"], 0)),
      priority: normalizeResearchPriority(pickString(record, ["priority", "level"], "MEDIUM")),
      urgency: pickString(record, ["urgency", "reason"], "观察中"),
      searchIntent: pickString(record, ["searchIntent", "intent"], "未分类"),
      actionHref: pickString(record, ["actionHref", "href"], "") || null
    };
  });
}

function normalizeResearchPerformanceMatrix(input: unknown[]): AdminResearchPerformanceMatrixItem[] {
  return input.map((item, index) => {
    const record = asRecord(item);

    return {
      title: pickString(record, ["title", "article"], `内容 ${index + 1}`),
      path: pickString(record, ["path", "pageUrl", "url"], ""),
      category: normalizeMatrixCategory(pickString(record, ["category"], "Underperformer")),
      priority: normalizeResearchPriority(pickString(record, ["priority", "level"], "MEDIUM")),
      clicks: pickNumber(record, ["clicks"], 0),
      impressions: pickNumber(record, ["impressions"], 0),
      ctr: pickNumber(record, ["ctr"], 0),
      avgPosition: pickNumber(record, ["avgPosition", "position"], 0),
      trendPercent: pickNumber(record, ["trendPercent", "changePercent"], 0),
      seoScore: normalizeNullableNumber(record, ["seoScore", "performanceScore"]),
      action: pickString(record, ["action", "actionLabel"], "查看文章"),
      actionHref: pickString(record, ["actionHref", "href"], "") || null
    };
  });
}

export function buildResearchViewFromAdminViews(
  mode: AdminResearchMode,
  priorities: AdminPriorityBoardView,
  performance: AdminPerformanceReviewView,
  searchConsole: AdminSearchConsoleView
): AdminResearchView {
  const prioritySignals = priorities.items.map(priorityItemToResearchSignal);
  const performanceSignals = performance.items.map(performanceItemToResearchSignal);
  const signals = dedupeResearchSignals([...prioritySignals, ...performanceSignals]).sort((a, b) => b.score - a.score);
  const clusters = buildResearchClusters(performance.items, searchConsole.snapshots);
  const trends = buildResearchTrends(performance.items);
  const performanceMatrix = buildResearchPerformanceMatrix(performance.items, searchConsole.snapshots);
  const topicRunActions = normalizeResearchTopicRunActions(priorities.items, performance.items);

  return {
    organization: performance.organization.id ? performance.organization : priorities.organization,
    generatedAt: performance.generatedAt || priorities.generatedAt || new Date().toISOString(),
    mode,
    summary: {
      quickWins: signals.filter((item) => item.kind === "quick_win").length,
      competitorGaps: signals.filter((item) => item.kind === "gap").length,
      clusters: clusters.length,
      trends: trends.length,
      stars: performanceMatrix.filter((item) => item.category === "Star").length,
      underperformers: performanceMatrix.filter((item) => item.category === "Underperformer").length,
      declining: signals.filter((item) => item.kind === "declining").length,
      opportunities: signals.filter((item) => ["quick_win", "topic_opportunity", "gap", "cluster"].includes(item.kind)).length,
      topicRuns: performance.items.filter((item) => item.kind === "topic_opportunity" || item.kind === "agent_step").length,
      searchConsoleProperties: searchConsole.properties.length
    },
    signals,
    clusters,
    trends,
    performanceMatrix,
    topicRunActions,
    topicRuns: performance.items.filter((item) => item.kind === "topic_opportunity" || item.kind === "agent_step"),
    notes: [
      "统一视图由优先级板、性能复盘和 Search Console 客户端响应合成。",
      "先处理快赢和低 CTR，再看主题集群、趋势和矩阵止损项。"
    ]
  };
}

function priorityItemToResearchSignal(item: AdminPriorityBoardItem): AdminResearchSignal {
  return {
    id: `priority-${item.id}`,
    title: item.title,
    subtitle: item.summary || item.reason,
    score: item.score,
    tone: item.level,
    kind: item.kind,
    source: "priorities",
    actionLabel: item.actionLabel,
    actionType: item.actionType,
    actionHref: item.actionHref,
    evidence: item.evidence,
    metrics: item.metrics,
    relatedItems: [item.store, item.article, item.campaign].filter(Boolean) as string[]
  };
}

function performanceItemToResearchSignal(item: AdminPerformanceReviewItem): AdminResearchSignal {
  const kind = item.kind === "topic_opportunity" ? "cluster" : item.kind;

  return {
    id: `performance-${item.id}`,
    title: item.title,
    subtitle: item.summary || item.reason,
    score: item.score,
    tone: item.level,
    kind,
    source: "performance_review",
    actionLabel: item.actionLabel,
    actionType: item.actionType,
    actionHref: item.actionHref,
    evidence: item.evidence,
    metrics: item.metrics,
    relatedItems: [item.store, item.article, item.locale].filter(Boolean) as string[]
  };
}

function normalizeResearchTopicRunActions(
  topicRunActions: unknown[],
  topicRuns: AdminPerformanceReviewItem[]
): AdminResearchTopicRunAction[] {
  const normalizedActions = topicRunActions.map((item, index) => {
    const record = asRecord(item);
    const metrics = asRecord(record.metrics);
    return {
      id: pickString(record, ["id"], `topic-run-action-${index}`),
      topicRunId: pickString(record, ["topicRunId"], pickString(record, ["topicRun", "runId"], "")),
      title: pickString(record, ["title"], "未命名主题任务"),
      summary: pickString(record, ["summary"], "暂无摘要"),
      reason: pickString(record, ["reason"], "暂无原因"),
      score: clampPercent(pickNumber(record, ["score"], 0)),
      level: normalizePriorityLevel(pickString(record, ["level"], "medium")),
      kind: normalizeResearchTopicRunActionKind(pickString(record, ["kind"], "topic_opportunity")),
      source: pickString(record, ["source"], "research"),
      actionLabel: pickString(record, ["actionLabel", "action"], "查看"),
      actionType: normalizePriorityActionType(pickString(record, ["actionType"], "view_run")),
      actionHref: pickString(record, ["actionHref", "href"], "") || null,
      articleId: pickString(record, ["articleId"], "") || null,
      campaignId: pickString(record, ["campaignId"], "") || null,
      storeId: pickString(record, ["storeId"], "") || null,
      store: pickString(record, ["store"], "") || null,
      article: pickString(record, ["article"], "") || null,
      campaign: pickString(record, ["campaign"], "") || null,
      locale: pickString(record, ["locale"], "") || null,
      evidence: pickStringArray(record, ["evidence"]),
      metrics: topicRunMetricsFromReview({
        clicks: normalizeNullableNumber(metrics, ["clicks"]),
        impressions: normalizeNullableNumber(metrics, ["impressions"]),
        ctr: normalizeNullableNumber(metrics, ["ctr"]),
        position: normalizeNullableNumber(metrics, ["position"]),
        performanceScore: normalizeNullableNumber(metrics, ["performanceScore", "performance_score"]),
        changePercent: normalizeNullableNumber(metrics, ["changePercent", "change_percent"]),
        opportunityScore: normalizeNullableNumber(metrics, ["opportunityScore", "opportunity_score"]),
        memoryRisk: normalizeNullableNumber(metrics, ["memoryRisk", "memory_risk"]),
        potentialClicks: normalizeNullableNumber(metrics, ["potentialClicks", "potential_clicks"]),
        trendPercent: normalizeNullableNumber(metrics, ["trendPercent", "trend_percent"]),
        trafficLoss: normalizeNullableNumber(metrics, ["trafficLoss", "traffic_loss"]),
        queryCount: normalizeNullableNumber(metrics, ["queryCount", "query_count"])
      }),
      updatedAt: formatRequiredIsoDate(pickString(record, ["updatedAt"], ""))
    };
  });

  const performanceActions = topicRuns
    .filter((item) => ["topic_opportunity", "agent_step", "reflection_task", "memory_risk"].includes(item.kind))
    .map((item) => ({
      id: `topic-run-${item.id}`,
      topicRunId: item.articleId ?? item.storeId ?? item.id,
      title: item.title,
      summary: item.summary,
      reason: item.reason,
      score: item.score,
      level: item.level,
      kind: normalizeResearchTopicRunActionKind(item.kind),
      source: "performance_review",
      actionLabel: item.actionLabel,
      actionType: item.actionType,
      actionHref: item.actionHref,
      articleId: item.articleId,
      campaignId: null,
      storeId: item.storeId,
      store: item.store,
      article: item.article,
      campaign: null,
      locale: item.locale,
      evidence: item.evidence,
      metrics: topicRunMetricsFromReview(item.metrics),
      updatedAt: item.updatedAt
    }));

  return dedupeTopicRunActions([...normalizedActions, ...performanceActions]).slice(0, 16);
}

function dedupeResearchSignals(signals: AdminResearchSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.kind}:${signal.title}:${signal.actionHref ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeTopicRunActions(actions: AdminResearchTopicRunAction[]) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.topicRunId}:${action.title}:${action.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildResearchClusters(items: AdminPerformanceReviewItem[], snapshots: AdminSearchConsoleSnapshotOverview[]): AdminResearchCluster[] {
  const grouped = new Map<string, AdminSearchConsoleSnapshotOverview[]>();
  for (const snapshot of snapshots) {
    const keyword = snapshot.topQuery ?? snapshot.article;
    const topic = keyword.split(/\s+/).slice(0, 3).join(" ") || snapshot.article;
    grouped.set(topic, [...(grouped.get(topic) ?? []), snapshot]);
  }

  const snapshotClusters = [...grouped.entries()].slice(0, 8).map(([topic, group]) => {
    const totalImpressions = group.reduce((total, item) => total + item.impressions, 0);
    const positions = group.map((item) => item.position).filter((value): value is number => value !== null);
    const avgPosition = positions.length ? positions.reduce((total, value) => total + value, 0) / positions.length : null;
    const authorityScore = clampPercent(Math.round((totalImpressions / 1000) * 12 + (avgPosition ? Math.max(0, 30 - avgPosition) : 0)));

    return {
      topic,
      primaryKeyword: group[0]?.topQuery ?? topic,
      authorityScore,
      authorityLevel: normalizeAuthorityLevel(authorityLevelForScore(authorityScore)),
      keywordCount: group.reduce((total, item) => total + item.queryCount, 0),
      totalImpressions,
      avgPosition,
      gapCount: group.filter((item) => (item.position ?? 99) > 10).length,
      topKeywords: group.map((item) => item.topQuery).filter(Boolean).slice(0, 5) as string[],
      gapKeywords: group.filter((item) => (item.position ?? 99) > 10).map((item) => item.topQuery ?? item.article).slice(0, 5),
      actionHref: "/campaigns#new-campaign",
      actionLabel: "创建集群内容"
    };
  });

  const runClusters = items
    .filter((item) => item.kind === "topic_opportunity")
    .slice(0, 8)
    .map((item) => ({
      topic: item.title,
      primaryKeyword: item.campaignDraft?.primaryKeyword ?? item.title,
      authorityScore: item.score,
      authorityLevel: normalizeAuthorityLevel(authorityLevelForScore(item.score)),
      keywordCount: item.campaignDraft?.keywords.length ?? 0,
      totalImpressions: item.metrics.impressions ?? 0,
      avgPosition: item.metrics.position,
      gapCount: Math.max(1, item.evidence.length),
      topKeywords: item.campaignDraft?.keywords.slice(0, 5) ?? [],
      gapKeywords: item.evidence.slice(0, 5),
      actionHref: item.actionHref,
      actionLabel: item.actionLabel
    }));

  return dedupeClusters([...runClusters, ...snapshotClusters]).slice(0, 12);
}

function buildResearchTrends(items: AdminPerformanceReviewItem[]): AdminResearchTrend[] {
  return items
    .filter((item) => item.kind === "trend" || (item.metrics.trendPercent ?? 0) > 0)
    .map((item) => ({
      keyword: item.campaignDraft?.primaryKeyword ?? item.title,
      growthPercent: item.metrics.trendPercent ?? item.metrics.changePercent ?? 0,
      position: item.metrics.position,
      impressions: item.metrics.impressions ?? 0,
      score: item.score,
      priority: priorityLevelToResearchPriority(item.level),
      urgency: item.reason,
      searchIntent: item.kind === "trend" ? "趋势捕获" : "内容更新",
      actionHref: item.actionHref
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function buildResearchPerformanceMatrix(
  items: AdminPerformanceReviewItem[],
  snapshots: AdminSearchConsoleSnapshotOverview[]
): AdminResearchPerformanceMatrixItem[] {
  const fromSnapshots = snapshots.map((snapshot) => ({
    title: snapshot.article,
    path: snapshot.pageUrl,
    category: matrixCategoryFromMetrics(snapshot.position ?? 99, snapshot.ctr, 0),
    priority: snapshot.performanceScore !== null && snapshot.performanceScore >= 75 ? "LOW" as const : "HIGH" as const,
    clicks: snapshot.clicks,
    impressions: snapshot.impressions,
    ctr: snapshot.ctr,
    avgPosition: snapshot.position ?? 0,
    trendPercent: 0,
    seoScore: snapshot.performanceScore,
    action: "查看文章",
    actionHref: snapshot.articleId ? `/articles/${snapshot.articleId}` : null
  }));

  const fromItems = items
    .filter((item) => item.articleId || item.kind === "declining" || item.kind === "low_ctr" || item.kind === "quick_win")
    .map((item) => ({
      title: item.article ?? item.title,
      path: item.actionHref ?? "",
      category: matrixCategoryFromKind(item.kind),
      priority: priorityLevelToResearchPriority(item.level),
      clicks: item.metrics.clicks ?? 0,
      impressions: item.metrics.impressions ?? 0,
      ctr: item.metrics.ctr ?? 0,
      avgPosition: item.metrics.position ?? 0,
      trendPercent: item.metrics.trendPercent ?? item.metrics.changePercent ?? 0,
      seoScore: item.metrics.performanceScore,
      action: item.actionLabel,
      actionHref: item.actionHref
    }));

  return dedupeMatrixItems([...fromItems, ...fromSnapshots]).slice(0, 20);
}

function dedupeClusters(clusters: AdminResearchCluster[]) {
  const seen = new Set<string>();
  return clusters.filter((cluster) => {
    const key = cluster.topic.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeMatrixItems(items: AdminResearchPerformanceMatrixItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title}:${item.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMatrixCategory(value: string): AdminResearchPerformanceMatrixItem["category"] {
  if (value === "Star" || value === "Overperformer" || value === "Underperformer" || value === "Declining") {
    return value;
  }
  if (value.toLowerCase() === "star") return "Star";
  if (value.toLowerCase() === "overperformer") return "Overperformer";
  if (value.toLowerCase() === "declining") return "Declining";
  return "Underperformer";
}

function pickOrganization(record: Record<string, unknown>) {
  const organization = pickRecord(record, ["organization", "org"]);
  return {
    id: pickString(organization, ["id"], ""),
    slug: pickString(organization, ["slug"], ""),
    name: pickString(organization, ["name"], "demo"),
    locale: pickString(organization, ["locale"], "zh-CN"),
    timezone: pickString(organization, ["timezone"], "Asia/Shanghai"),
    plan: pickString(organization, ["plan"], "demo")
  };
}

function normalizeCampaignDraft(record: Record<string, unknown>) {
  const draft = pickRecord(record, ["campaignDraft", "draft"]);
  if (Object.keys(draft).length === 0) return null;

  return {
    storeId: pickString(draft, ["storeId"], "") || null,
    locale: pickString(draft, ["locale"], "") || null,
    sourceType: pickString(draft, ["sourceType"], "manual_topic") as "product" | "collection" | "manual_topic",
    sourceId: pickString(draft, ["sourceId"], "") || null,
    topic: pickString(draft, ["topic"], "") || null,
    primaryKeyword: pickString(draft, ["primaryKeyword"], "") || null,
    keywords: pickStringArray(draft, ["keywords"]),
    publishPolicy: pickString(draft, ["publishPolicy"], "manual_review") as PublishPolicy,
    targetWordCount: pickNumber(draft, ["targetWordCount"], 1400)
  };
}

function normalizeNullableNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function normalizeTone(value: string): BadgeTone {
  if (["good", "success", "active", "published", "succeeded"].includes(value)) return "good";
  if (["warn", "warning", "queued", "running", "retrying", "paused"].includes(value)) return "warn";
  if (["danger", "error", "failed", "quality_failed", "disconnected", "suspended"].includes(value)) return "danger";
  return "neutral";
}

function normalizeSearchConsoleStatus(value: string): AdminSearchConsolePropertyOverview["status"] {
  if (value === "active" || value === "needs_auth" || value === "disconnected" || value === "archived") return value;
  return "active";
}

function normalizeJobType(value: string): AdminJobType | null {
  if (!value) return null;
  if (
    value === "generate_article" ||
    value === "translate_article" ||
    value === "generate_asset" ||
    value === "publish_article" ||
    value === "sync_product" ||
    value === "sync_collection" ||
    value === "sync_search_console"
  ) {
    return value as AdminJobType;
  }
  return null;
}

function normalizePriorityKind(value: string): AdminPriorityBoardItem["kind"] {
  if (
    value === "quick_win" ||
    value === "declining" ||
    value === "low_ctr" ||
    value === "topic_opportunity" ||
    value === "reflection_task" ||
    value === "agent_step" ||
    value === "memory_risk"
  ) {
    return value;
  }
  return "quick_win";
}

function normalizePriorityLevel(value: string): AdminPriorityBoardItem["level"] {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function normalizePriorityActionType(value: string): AdminPriorityBoardItem["actionType"] {
  if (
    value === "review_article" ||
    value === "sync_search_console" ||
    value === "publish_article" ||
    value === "repair_article" ||
    value === "open_campaign" ||
    value === "new_campaign" ||
    value === "open_search_console" ||
    value === "view_run"
  ) {
    return value;
  }
  return "view_run";
}

function normalizePerformanceReviewKind(value: string): AdminPerformanceReviewItem["kind"] {
  if (
    value === "quick_win" ||
    value === "declining" ||
    value === "low_ctr" ||
    value === "topic_opportunity" ||
    value === "trend" ||
    value === "memory_risk" ||
    value === "agent_step"
  ) {
    return value;
  }
  return "quick_win";
}

function normalizeResearchKind(value: string): AdminResearchSignal["kind"] {
  if (
    value === "quick_win" ||
    value === "declining" ||
    value === "low_ctr" ||
    value === "topic_opportunity" ||
    value === "reflection_task" ||
    value === "agent_step" ||
    value === "memory_risk" ||
    value === "trend" ||
    value === "cluster" ||
    value === "gap" ||
    value === "matrix"
  ) {
    return value;
  }
  return "quick_win";
}

function normalizeResearchTopicRunActionKind(value: string): AdminResearchTopicRunAction["kind"] {
  if (value === "topic_opportunity" || value === "topic_refresh" || value === "topic_gap" || value === "topic_cluster") {
    return value;
  }
  return "topic_opportunity";
}

function topicRunMetricsFromReview(metrics: AdminPerformanceReviewItem["metrics"]): AdminResearchTopicRunAction["metrics"] {
  return {
    clicks: metrics.clicks,
    impressions: metrics.impressions,
    ctr: metrics.ctr,
    position: metrics.position,
    performanceScore: metrics.performanceScore,
    changePercent: metrics.changePercent,
    opportunityScore: metrics.opportunityScore,
    memoryRisk: metrics.memoryRisk,
    potentialClicks: metrics.potentialClicks,
    trendPercent: metrics.trendPercent ?? null,
    trafficLoss: metrics.trafficLoss ?? null,
    queryCount: metrics.queryCount ?? null
  };
}

function normalizeResearchMode(value: string): AdminResearchMode {
  if (
    value === "overview" ||
    value === "quick_wins" ||
    value === "competitor_gaps" ||
    value === "topic_clusters" ||
    value === "trends" ||
    value === "performance_matrix"
  ) {
    return value;
  }
  return "overview";
}

function normalizeResearchPriority(value: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (value === "CRITICAL" || value === "HIGH" || value === "MEDIUM" || value === "LOW") return value;
  if (value === "critical") return "CRITICAL";
  if (value === "high") return "HIGH";
  if (value === "low") return "LOW";
  return "MEDIUM";
}

function normalizeAuthorityLevel(value: string): "Strong" | "Moderate" | "Weak" | "Minimal" {
  if (value === "Strong" || value === "Moderate" || value === "Weak" || value === "Minimal") return value;
  return "Moderate";
}

function authorityLevelForScore(score: number) {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Moderate";
  if (score >= 35) return "Weak";
  return "Minimal";
}

function matrixCategoryFromKind(kind: string): "Star" | "Overperformer" | "Underperformer" | "Declining" {
  if (kind === "quick_win") return "Star";
  if (kind === "trend" || kind === "topic_opportunity") return "Overperformer";
  if (kind === "declining") return "Declining";
  return "Underperformer";
}

function matrixCategoryFromMetrics(position: number, ctr: number, trendPercent: number): "Star" | "Overperformer" | "Underperformer" | "Declining" {
  if (position <= 3 && ctr >= 0.06) return "Star";
  if (position <= 10 || ctr >= 0.03) return "Overperformer";
  if (trendPercent < 0) return "Declining";
  return "Underperformer";
}

function priorityLevelToResearchPriority(level: AdminPriorityBoardItem["level"]): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (level === "critical") return "CRITICAL";
  if (level === "high") return "HIGH";
  if (level === "low") return "LOW";
  return "MEDIUM";
}

function storeTone(status: string): BadgeTone {
  if (["active", "connected", "已连接"].includes(status)) return "good";
  if (["installing", "syncing", "同步中"].includes(status)) return "warn";
  if (["disconnected", "suspended", "archived", "需授权"].includes(status)) return "danger";
  return "neutral";
}

function campaignTone(status: string): BadgeTone {
  if (["active", "completed"].includes(status)) return "good";
  if (["paused", "draft"].includes(status)) return "warn";
  if (status === "failed") return "danger";
  return "neutral";
}

function articleTone(status: string): BadgeTone {
  if (["ready_to_publish", "published"].includes(status)) return "good";
  if (["publishing", "draft"].includes(status)) return "warn";
  if (["quality_failed", "failed"].includes(status)) return "danger";
  return "neutral";
}

function logTone(level: string): BadgeTone {
  if (level === "error") return "danger";
  if (level === "warn" || level === "warning") return "warn";
  return "good";
}

function jobTone(status: string): BadgeTone {
  if (["succeeded", "published", "completed"].includes(status)) return "good";
  if (["queued", "running", "retrying", "started"].includes(status)) return "warn";
  if (["failed", "error"].includes(status)) return "danger";
  return "neutral";
}

function normalizeStoreStatus(status: string) {
  const labels: Record<string, string> = {
    active: "已连接",
    connected: "已连接",
    installing: "安装中",
    syncing: "同步中",
    disconnected: "需授权",
    suspended: "已暂停",
    archived: "已归档"
  };
  return labels[status] ?? status;
}

function formatPublishPolicy(policy: string) {
  const labels: Record<PublishPolicy | string, string> = {
    auto_when_qualified: "达标自动发布",
    manual_review: "人工复核",
    direct: "直接发布"
  };
  return labels[policy] ?? policy;
}

export function formatCampaignStatus(status: string) {
  const labels: Record<CampaignStatus | string, string> = {
    draft: "草稿",
    active: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败"
  };
  return labels[status] ?? status;
}

export function formatArticleStatus(status: string) {
  const labels: Record<ArticleStatus | string, string> = {
    draft: "草稿",
    quality_failed: "质检失败",
    ready_to_publish: "待发布",
    publishing: "发布中",
    published: "已发布",
    failed: "失败"
  };
  return labels[status] ?? status;
}

export function formatPriorityKind(kind: string) {
  const labels: Record<string, string> = {
    quick_win: "快赢",
    declining: "下滑",
    low_ctr: "低 CTR",
    topic_opportunity: "主题机会",
    trend: "趋势",
    reflection_task: "反思任务",
    agent_step: "步骤告警",
    memory_risk: "记忆风险"
  };
  return labels[kind] ?? kind;
}

export function formatPriorityLevel(level: string) {
  const labels: Record<string, string> = {
    critical: "致命",
    high: "高",
    medium: "中",
    low: "低"
  };
  return labels[level] ?? level;
}

export function formatJobStatus(status: string) {
  const labels: Record<JobStatus | string, string> = {
    queued: "排队中",
    running: "运行中",
    succeeded: "成功",
    failed: "失败",
    retrying: "重试中",
    started: "已开始",
    published: "已发布",
    completed: "已完成",
    skipped: "已跳过"
  };
  return labels[status] ?? status;
}

export function formatLogLevel(level: string) {
  const labels: Record<string, string> = {
    debug: "调试",
    info: "信息",
    warn: "警告",
    warning: "警告",
    error: "错误"
  };
  return labels[level] ?? level;
}

function formatSource(record: Record<string, unknown>) {
  const sourceType = pickString(record, ["sourceType"], "");
  const sourceId = pickString(record, ["sourceId"], "");
  const topic = pickString(record, ["topic"], "");
  const source = pickString(record, ["source"], "");
  if (source) return source;
  if (topic) return `Manual: ${topic}`;
  if (sourceType && sourceId) return `${sourceType}: ${sourceId}`;
  return sourceType || "未设置来源";
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateOnly(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function formatIsoDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function formatRequiredIsoDate(value: string) {
  return formatIsoDate(value) ?? "";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
