import { headers } from "next/headers";
import type { ArticleStatus, CampaignStatus, JobStatus, PublishPolicy, SupportedLocale } from "@shopify-ai-blog/shared";

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
  publishPolicy: string;
  targetWordCount?: number;
  primaryKeyword?: string;
}

export interface AdminArticleView {
  id: string;
  title: string;
  store: string;
  locale: string;
  status: ArticleStatus | string;
  statusTone: BadgeTone;
  seoScore: number | null;
  updatedAt: string;
  publishPolicy?: string;
  failureReason?: string;
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
  if (configured) return configured;

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host) return "http://localhost:3000";

  const proto = headerList.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
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

  return {
    data: {
      metrics: normalizeMetrics(pickCollection(record, ["metrics", "kpis", "summary"]), { stores, campaigns, articles, logs }),
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
      store: pickString(record, ["storeName"], pickString(store, ["name", "myshopifyDomain"], "未绑定店铺")),
      locale: pickString(record, ["locale"], "zh-CN"),
      source: formatSource(record),
      status,
      statusTone: campaignTone(status),
      progress: clampPercent(pickNumber(record, ["progress", "progressPercent"], total > 0 ? (generated / total) * 100 : 0)),
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
      store: pickString(record, ["storeName"], pickString(store, ["name", "myshopifyDomain"], "未绑定店铺")),
      locale: pickString(record, ["locale"], "zh-CN"),
      status,
      statusTone: articleTone(status),
      seoScore: normalizeNullableNumber(record, ["seoScore", "qualityScore"]),
      updatedAt: formatDate(pickString(record, ["updatedAt", "lastGeneratedAt", "createdAt"], "")),
      publishPolicy: formatPublishPolicy(pickString(record, ["publishPolicy"], "")),
      failureReason: pickString(record, ["failureReason", "errorMessage"], "")
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
      apiKeyMasked: pickString(record, ["apiKeyMasked", "maskedApiKey"], "已加密保存，不回显明文"),
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

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
