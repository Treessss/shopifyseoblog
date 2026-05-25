import type { Job } from "bullmq";
import { encryptSecret, maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import type { AgentMemoryOutcome, Prisma } from "@shopify-ai-blog/db";
import {
  QUEUE_NAMES,
  SEARCH_CONSOLE_JOB_NAMES,
  type SearchConsoleJobName,
  type SearchConsoleQueueJobData,
  type SearchConsoleArticleSyncJobData,
  type SearchConsoleStoreSyncJobData,
  type WorkerJobResult
} from "../queues";
import {
  completePublishJob,
  errorMessage,
  externalJobId,
  failPublishJob,
  startPublishJob,
  writePublishLog
} from "./db-helpers";
import {
  domainError,
  failureJobStatus,
  failurePayload,
  failurePublishEvent,
  getErrorMessage,
  parseIntegerEnv,
  throwForBullMQ,
  toPrismaJson,
  trimForDb
} from "./shared";

export type SearchConsoleJob = Job<
  SearchConsoleQueueJobData,
  WorkerJobResult,
  SearchConsoleJobName
>;

interface SearchConsoleDateRange {
  startDate: string;
  endDate: string;
}

interface SearchConsoleRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface SearchConsoleQueryRequest {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  dimensionFilterGroups?: Array<{
    groupType?: "and" | "or";
    filters: Array<{
      dimension: string;
      operator: "equals" | "contains" | "notContains" | "includingRegex" | "excludingRegex";
      expression: string;
    }>;
  }>;
  aggregationType?: "auto" | "byPage" | "byProperty";
  rowLimit?: number;
  startRow?: number;
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  dataState?: "final" | "all";
}

interface SearchConsoleQueryResponse {
  rows?: SearchConsoleRow[];
  responseAggregationType?: string;
  metadata?: Record<string, unknown>;
}

type SearchConsolePropertyRow = NonNullable<Awaited<ReturnType<typeof resolveSearchConsoleProperty>>>;
type PublishedArticleRow = Awaited<ReturnType<typeof findArticleForSearchConsoleSync>>;

export async function processSearchConsoleJob(job: SearchConsoleJob): Promise<WorkerJobResult> {
  if (job.name === SEARCH_CONSOLE_JOB_NAMES.articleSync) {
    return processSearchConsoleArticleSync(job as Job<SearchConsoleArticleSyncJobData, WorkerJobResult, SearchConsoleJobName>);
  }

  if (job.name === SEARCH_CONSOLE_JOB_NAMES.storeSync) {
    return processSearchConsoleStoreSync(job as Job<SearchConsoleStoreSyncJobData, WorkerJobResult, SearchConsoleJobName>);
  }

  throw domainError("UNSUPPORTED_SEARCH_CONSOLE_JOB", `Unsupported Search Console job: ${job.name}`, {
    retryable: false
  });
}

async function processSearchConsoleStoreSync(job: Job<SearchConsoleStoreSyncJobData, WorkerJobResult, SearchConsoleJobName>) {
  const data = job.data;
  const publishJob = await startPublishJob({
    jobId: data.publishJobId,
    organizationId: data.organizationId,
    storeId: data.storeId,
    type: "sync_search_console",
    externalJobId: externalJobId(QUEUE_NAMES.seoPerformance, job.name, job),
    payload: data
  });

  try {
    const property = await resolveSearchConsoleProperty(data);
    const accessToken = await resolveSearchConsoleAccessToken(property);
    const dateRange = resolveSearchConsoleDateRange(data);
    const articles = await findArticlesForSearchConsoleSync(data);
    let syncedArticles = 0;
    let syncedQueries = 0;
    const failures: Array<{ articleId: string; reason: string }> = [];

    for (const article of articles) {
      try {
        const result = await syncArticleSearchConsolePerformance({
          property,
          accessToken,
          article,
          dateRange,
          dataState: data.dataState ?? "final",
          rowLimit: data.rowLimit
        });
        syncedArticles += 1;
        syncedQueries += result.queryCount;
      } catch (error) {
        failures.push({ articleId: article.id, reason: getErrorMessage(error) });
      }
    }

    await prisma.searchConsoleProperty.update({
      where: { id: property.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: failures.length ? trimForDb(JSON.stringify(failures.slice(0, 5))) : null
      }
    });
    await completePublishJob(publishJob.id, {
      propertyId: property.id,
      siteUrl: property.siteUrl,
      syncedArticles,
      syncedQueries,
      failures
    });

    await writePublishLog({
      organizationId: data.organizationId,
      storeId: data.storeId,
      jobId: publishJob.id,
      event: failures.length ? "skipped" : "succeeded",
      level: failures.length ? "warn" : "info",
      message: failures.length
        ? `Search Console sync completed with ${failures.length} article failure(s).`
        : "Search Console performance sync completed.",
      payload: { propertyId: property.id, syncedArticles, syncedQueries, failures }
    });

    return searchConsoleResult(job, data, "Search Console store performance synced.", {
      articles: syncedArticles,
      queries: syncedQueries,
      snapshots: syncedArticles
    });
  } catch (error) {
    await failPublishJob(publishJob.id, errorMessage(error), failurePayload(error, data) as Record<string, unknown> | undefined, failureJobStatus(job, error));
    await writePublishLog({
      organizationId: data.organizationId,
      storeId: data.storeId,
      jobId: publishJob.id,
      event: failurePublishEvent(job, error),
      level: failureJobStatus(job, error) === "retrying" ? "warn" : "error",
      message: `Search Console sync failed: ${getErrorMessage(error)}`,
      payload: failurePayload(error, data) as Record<string, unknown> | undefined
    });
    throwForBullMQ(error);
  }
}

async function processSearchConsoleArticleSync(job: Job<SearchConsoleArticleSyncJobData, WorkerJobResult, SearchConsoleJobName>) {
  const data = job.data;
  const publishJob = await startPublishJob({
    jobId: data.publishJobId,
    organizationId: data.organizationId,
    storeId: data.storeId,
    articleId: data.articleId,
    type: "sync_search_console",
    externalJobId: externalJobId(QUEUE_NAMES.seoPerformance, job.name, job),
    payload: data
  });

  try {
    const [property, article] = await Promise.all([
      resolveSearchConsoleProperty(data),
      findArticleForSearchConsoleSync(data.organizationId, data.storeId, data.articleId)
    ]);
    const accessToken = await resolveSearchConsoleAccessToken(property);
    const result = await syncArticleSearchConsolePerformance({
      property,
      accessToken,
      article,
      dateRange: resolveSearchConsoleDateRange(data),
      dataState: data.dataState ?? "final",
      rowLimit: data.rowLimit
    });

    await completePublishJob(publishJob.id, {
      propertyId: property.id,
      articleId: article.id,
      snapshotId: result.snapshotId,
      queryCount: result.queryCount
    });
    await writePublishLog({
      organizationId: data.organizationId,
      storeId: data.storeId,
      articleId: article.id,
      jobId: publishJob.id,
      event: "succeeded",
      message: "Article Search Console performance synced.",
      payload: { propertyId: property.id, snapshotId: result.snapshotId, queryCount: result.queryCount }
    });

    return searchConsoleResult(job, data, "Search Console article performance synced.", {
      articles: 1,
      queries: result.queryCount,
      snapshots: 1
    }, article.id);
  } catch (error) {
    await failPublishJob(publishJob.id, errorMessage(error), failurePayload(error, data) as Record<string, unknown> | undefined, failureJobStatus(job, error));
    await writePublishLog({
      organizationId: data.organizationId,
      storeId: data.storeId,
      articleId: data.articleId,
      jobId: publishJob.id,
      event: failurePublishEvent(job, error),
      level: failureJobStatus(job, error) === "retrying" ? "warn" : "error",
      message: `Article Search Console sync failed: ${getErrorMessage(error)}`,
      payload: failurePayload(error, data) as Record<string, unknown> | undefined
    });
    throwForBullMQ(error);
  }
}

async function syncArticleSearchConsolePerformance(input: {
  property: SearchConsolePropertyRow;
  accessToken: string;
  article: PublishedArticleRow;
  dateRange: SearchConsoleDateRange;
  dataState: "final" | "all";
  rowLimit?: number;
}) {
  if (!input.article.canonicalUrl) {
    throw domainError("ARTICLE_CANONICAL_URL_REQUIRED", "Article needs a canonical URL before GSC performance can be synced.", {
      retryable: false,
      details: { articleId: input.article.id }
    });
  }

  const pageRows = await querySearchConsole(input.property.siteUrl, input.accessToken, {
    startDate: input.dateRange.startDate,
    endDate: input.dateRange.endDate,
    dimensions: ["page"],
    dimensionFilterGroups: [pageFilter(input.article.canonicalUrl)],
    aggregationType: "byPage",
    rowLimit: 1,
    dataState: input.dataState
  });
  const queryRows = await querySearchConsole(input.property.siteUrl, input.accessToken, {
    startDate: input.dateRange.startDate,
    endDate: input.dateRange.endDate,
    dimensions: ["query"],
    dimensionFilterGroups: [pageFilter(input.article.canonicalUrl)],
    aggregationType: "byPage",
    rowLimit: Math.min(Math.max(input.rowLimit ?? 25, 1), 25000),
    dataState: input.dataState
  });
  const pageMetrics = normalizeSearchConsoleRow(pageRows.rows?.[0]);
  const topQuery = queryRows.rows?.[0]?.keys?.[0] ?? null;
  const score = scoreSearchConsolePerformance(pageMetrics);
  const startDate = dateOnlyToDate(input.dateRange.startDate);
  const endDate = dateOnlyToDate(input.dateRange.endDate);

  const snapshot = await prisma.articleSeoPerformanceSnapshot.upsert({
    where: {
      propertyId_articleId_startDate_endDate_dataState: {
        propertyId: input.property.id,
        articleId: input.article.id,
        startDate,
        endDate,
        dataState: input.dataState
      }
    },
    update: {
      pageUrl: input.article.canonicalUrl,
      clicks: pageMetrics.clicks,
      impressions: pageMetrics.impressions,
      ctr: pageMetrics.ctr,
      position: pageMetrics.position,
      queryCount: queryRows.rows?.length ?? 0,
      topQuery,
      performanceScore: score,
      syncedAt: new Date(),
      metadata: toPrismaJson({
        responseAggregationType: pageRows.responseAggregationType,
        metadata: pageRows.metadata
      })
    },
    create: {
      organizationId: input.article.organizationId,
      storeId: input.article.storeId,
      articleId: input.article.id,
      propertyId: input.property.id,
      pageUrl: input.article.canonicalUrl,
      startDate,
      endDate,
      dataState: input.dataState,
      clicks: pageMetrics.clicks,
      impressions: pageMetrics.impressions,
      ctr: pageMetrics.ctr,
      position: pageMetrics.position,
      queryCount: queryRows.rows?.length ?? 0,
      topQuery,
      performanceScore: score,
      metadata: toPrismaJson({
        responseAggregationType: pageRows.responseAggregationType,
        metadata: pageRows.metadata
      })
    }
  });

  await prisma.articleSeoQueryPerformance.deleteMany({ where: { snapshotId: snapshot.id } });
  if (queryRows.rows?.length) {
    await prisma.articleSeoQueryPerformance.createMany({
      data: queryRows.rows.map((row) => {
        const metrics = normalizeSearchConsoleRow(row);
        const query = row.keys?.[0] ?? "(unknown query)";
        return {
          organizationId: input.article.organizationId,
          storeId: input.article.storeId,
          articleId: input.article.id,
          propertyId: input.property.id,
          snapshotId: snapshot.id,
          pageUrl: input.article.canonicalUrl!,
          query,
          startDate,
          endDate,
          dataState: input.dataState,
          clicks: metrics.clicks,
          impressions: metrics.impressions,
          ctr: metrics.ctr,
          position: metrics.position,
          dedupeHash: hashStable([input.property.id, input.article.id, input.dateRange.startDate, input.dateRange.endDate, input.dataState, query].join("|")).toString(36),
          metadata: toPrismaJson({ keys: row.keys })
        };
      })
    });
  }

  await persistSearchConsoleMemory(input.article, {
    score,
    clicks: pageMetrics.clicks,
    impressions: pageMetrics.impressions,
    ctr: pageMetrics.ctr,
    position: pageMetrics.position,
    topQuery,
    dateRange: input.dateRange
  });
  await persistSearchConsoleAgentStep(input.article, input.property, {
    score,
    metrics: pageMetrics,
    topQuery,
    dateRange: input.dateRange,
    queryCount: queryRows.rows?.length ?? 0,
    snapshotId: snapshot.id
  });

  return {
    snapshotId: snapshot.id,
    queryCount: queryRows.rows?.length ?? 0
  };
}

async function resolveSearchConsoleProperty(input: { organizationId: string; storeId: string; propertyId?: string }) {
  const property = input.propertyId
    ? await prisma.searchConsoleProperty.findFirst({
        where: {
          id: input.propertyId,
          organizationId: input.organizationId,
          storeId: input.storeId,
          status: { not: "archived" }
        }
      })
    : await prisma.searchConsoleProperty.findFirst({
        where: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          status: "active"
        },
        orderBy: { updatedAt: "desc" }
      });

  if (property) return property;

  const store = await prisma.shopifyStore.findFirst({
    where: {
      id: input.storeId,
      organizationId: input.organizationId
    },
    select: {
      id: true,
      myshopifyDomain: true,
      metadata: true
    }
  });

  const publishedSiteUrl = store ? resolvePublishedSiteUrlFromStore(store) : undefined;
  const envSiteUrl = process.env.GSC_SITE_URL?.trim();
  const siteUrl = publishedSiteUrl ?? envSiteUrl;
  if (siteUrl) {
    return prisma.searchConsoleProperty.upsert({
      where: {
        storeId_siteUrl: {
          storeId: input.storeId,
          siteUrl
        }
      },
      update: {
        organizationId: input.organizationId,
        status: "active",
        metadata: toPrismaJson({
          authSource: publishedSiteUrl ? "store_metadata" : "environment"
        })
      },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        siteUrl,
        status: "active",
        scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        metadata: toPrismaJson({
          authSource: publishedSiteUrl ? "store_metadata" : "environment"
        })
      }
    });
  }

  throw domainError("SEARCH_CONSOLE_PROPERTY_NOT_CONFIGURED", "No active Google Search Console property is configured for this store.", {
    retryable: false,
    details: { storeId: input.storeId }
  });
}

async function resolveSearchConsoleAccessToken(property: SearchConsolePropertyRow): Promise<string> {
  const existingAccessToken = maybeDecryptSecret(property.accessTokenEncrypted);
  if (existingAccessToken && property.tokenExpiresAt && property.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return existingAccessToken;
  }

  const envAccessToken = process.env.GSC_ACCESS_TOKEN?.trim();
  if (envAccessToken) return envAccessToken;

  const refreshToken = maybeDecryptSecret(property.refreshTokenEncrypted) ?? process.env.GSC_REFRESH_TOKEN?.trim();
  const clientId = property.googleClientId ?? process.env.GSC_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = maybeDecryptSecret(property.googleClientSecretEncrypted) ?? process.env.GSC_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    await prisma.searchConsoleProperty.update({
      where: { id: property.id },
      data: {
        status: "needs_auth",
        lastSyncError: "Missing Search Console OAuth refresh token, client ID, or client secret. API keys cannot read performance data."
      }
    });
    throw domainError("SEARCH_CONSOLE_AUTH_REQUIRED", "Google Search Console performance sync needs OAuth credentials; an API key is not enough.", {
      retryable: false,
      details: { propertyId: property.id }
    });
  }

  const refreshed = await refreshGoogleAccessToken({ refreshToken, clientId, clientSecret });
  try {
    await prisma.searchConsoleProperty.update({
      where: { id: property.id },
      data: {
        accessTokenEncrypted: encryptSecret(refreshed.accessToken),
        tokenExpiresAt: refreshed.expiresAt,
        status: "active",
        lastSyncError: null
      }
    });
  } catch {
    await prisma.searchConsoleProperty.update({
      where: { id: property.id },
      data: {
        tokenExpiresAt: refreshed.expiresAt,
        status: "active",
        lastSyncError: null
      }
    });
  }

  return refreshed.accessToken;
}

async function refreshGoogleAccessToken(input: { refreshToken: string; clientId: string; clientSecret: string }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== "string") {
    throw domainError("SEARCH_CONSOLE_TOKEN_REFRESH_FAILED", "Google OAuth token refresh failed.", {
      retryable: response.status >= 500,
      details: { status: response.status, payload }
    });
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  return {
    accessToken: payload.access_token as string,
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000)
  };
}

async function querySearchConsole(siteUrl: string, accessToken: string, request: SearchConsoleQueryRequest): Promise<SearchConsoleQueryResponse> {
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw domainError("SEARCH_CONSOLE_QUERY_FAILED", "Google Search Console query failed.", {
      retryable: response.status >= 500 || response.status === 429,
      details: { status: response.status, payload }
    });
  }
  return payload as SearchConsoleQueryResponse;
}

function pageFilter(pageUrl: string): NonNullable<SearchConsoleQueryRequest["dimensionFilterGroups"]>[number] {
  return {
    groupType: "and",
    filters: [
      {
        dimension: "page",
        operator: "equals",
        expression: pageUrl
      }
    ]
  };
}

async function findArticlesForSearchConsoleSync(input: SearchConsoleStoreSyncJobData) {
  return prisma.blogArticle.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      ...(input.articleIds?.length ? { id: { in: input.articleIds } } : {}),
      status: "published",
      canonicalUrl: { not: null }
    },
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
    take: parseIntegerEnv("GSC_SYNC_ARTICLE_LIMIT", 100)
  });
}

async function findArticleForSearchConsoleSync(organizationId: string, storeId: string, articleId: string) {
  const article = await prisma.blogArticle.findFirst({
    where: {
      id: articleId,
      organizationId,
      storeId
    }
  });
  if (!article) {
    throw domainError("ARTICLE_NOT_FOUND", "Article was not found for Search Console sync.", {
      retryable: false,
      details: { articleId }
    });
  }
  return article;
}

function resolvePublishedSiteUrlFromStore(store: { myshopifyDomain: string; metadata?: unknown }): string | undefined {
  const metadata = isRecord(store.metadata) ? store.metadata : {};
  const candidate =
    stringValue(metadata.primaryDomainUrl) ??
    stringValue(metadata.shopUrl) ??
    stringValue(metadata.primaryDomainHost);

  if (candidate) {
    const normalized = normalizeStorefrontHostFromValue(candidate);
    if (normalized) return `https://${normalized}`;
  }

  return store.myshopifyDomain ? `https://${normalizeStorefrontHostFromValue(store.myshopifyDomain) ?? store.myshopifyDomain}` : undefined;
}

function normalizeStorefrontHostFromValue(value: string): string | undefined {
  const trimmed = value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveSearchConsoleDateRange(input: { startDate?: string; endDate?: string; days?: number }, now = new Date()): SearchConsoleDateRange {
  if (input.startDate && input.endDate) {
    return { startDate: input.startDate, endDate: input.endDate };
  }

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 2);
  const days = Math.max(1, Math.min(180, input.days ?? 28));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end)
  };
}

export function scoreSearchConsolePerformance(metrics: {
  clicks: number;
  impressions: number;
  ctr: number;
  position?: number | null;
}): number {
  const impressionScore = Math.min(30, Math.log10(metrics.impressions + 1) * 12);
  const clickScore = Math.min(30, Math.log10(metrics.clicks + 1) * 18);
  const ctrScore = Math.min(20, metrics.ctr * 240);
  const position = metrics.position ?? 100;
  const positionScore = position <= 3 ? 20 : position <= 10 ? 16 : position <= 20 ? 11 : position <= 50 ? 5 : 0;
  return Math.round(Math.max(0, Math.min(100, impressionScore + clickScore + ctrScore + positionScore)));
}

function normalizeSearchConsoleRow(row: SearchConsoleRow | undefined) {
  return {
    clicks: safeNumber(row?.clicks),
    impressions: safeNumber(row?.impressions),
    ctr: safeNumber(row?.ctr),
    position: row?.position === undefined ? null : safeNumber(row.position)
  };
}

async function persistSearchConsoleMemory(
  article: PublishedArticleRow,
  performance: {
    score: number;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
    topQuery: string | null;
    dateRange: SearchConsoleDateRange;
  }
) {
  const outcome: AgentMemoryOutcome =
    performance.clicks > 0 || performance.score >= 70 ? "success" : performance.impressions > 0 ? "warning" : "published";
  const learnedRule = buildSearchConsoleLearnedRule(article, performance);
  const existing = await prisma.agentMemory.findFirst({
    where: {
      organizationId: article.organizationId,
      storeId: article.storeId,
      articleId: article.id,
      keyword: article.primaryKeyword
    },
    orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }]
  });
  const data: Prisma.AgentMemoryUncheckedCreateInput = {
    organizationId: article.organizationId,
    storeId: article.storeId,
    articleId: article.id,
    campaignId: article.campaignId,
    locale: article.locale,
    sourceType: article.sourceType,
    sourceId: article.sourceId,
    keyword: article.primaryKeyword,
    topicFingerprint: normalizeMemoryTopic(article.title),
    outcome,
    confidence: Math.max(55, Math.min(95, performance.score)),
    qualityScore: article.seoScore,
    trafficScore: performance.score,
    learnedRule,
    evidence: toPrismaJson(performance),
    metadata: toPrismaJson({
      source: "google_search_console",
      dateRange: performance.dateRange,
      topQuery: performance.topQuery
    }),
    lastUsedAt: new Date()
  };

  if (existing) {
    await prisma.agentMemory.update({
      where: { id: existing.id },
      data
    });
    return;
  }

  await prisma.agentMemory.create({ data });
}

async function persistSearchConsoleAgentStep(
  article: PublishedArticleRow,
  property: SearchConsolePropertyRow,
  payload: {
    score: number;
    metrics: ReturnType<typeof normalizeSearchConsoleRow>;
    topQuery: string | null;
    dateRange: SearchConsoleDateRange;
    queryCount: number;
    snapshotId: string;
  }
) {
  const sequence = (await prisma.agentStep.count({ where: { articleId: article.id } })) + 1;
  await prisma.agentStep.create({
    data: {
      organizationId: article.organizationId,
      storeId: article.storeId,
      articleId: article.id,
      runId: `gsc:${property.id}:${payload.dateRange.startDate}:${payload.dateRange.endDate}`,
      sequence,
      stepType: "tool_call",
      stepKey: `gsc-performance-${payload.snapshotId}`,
      stage: "seo_performance",
      agentRole: "growth_analyst",
      status: payload.metrics.impressions > 0 ? "passed" : "warning",
      attempt: 1,
      maxAttempts: 3,
      idempotencyKey: `gsc:${property.id}:${article.id}:${payload.dateRange.startDate}:${payload.dateRange.endDate}`,
      canResume: true,
      title: "Google Search Console 效果同步",
      summary: `同步 ${payload.dateRange.startDate} 至 ${payload.dateRange.endDate} 的自然搜索表现。`,
      decision:
        payload.metrics.impressions > 0
          ? `获得 ${payload.metrics.clicks} clicks / ${payload.metrics.impressions} impressions，表现分 ${payload.score}。`
          : "该时间段暂未获得 GSC 曝光数据，后续需要继续观察或调整主题/内链。",
      input: toPrismaJson({
        siteUrl: property.siteUrl,
        pageUrl: article.canonicalUrl,
        dateRange: payload.dateRange
      }),
      output: toPrismaJson({
        ...payload.metrics,
        topQuery: payload.topQuery,
        performanceScore: payload.score,
        queryCount: payload.queryCount,
        snapshotId: payload.snapshotId
      }),
      evidence: toPrismaJson([{ source: "Google Search Console", url: article.canonicalUrl, metric: "search_analytics" }]),
      evidenceIds: [`gsc:${payload.snapshotId}`],
      warnings: payload.metrics.impressions > 0 ? [] : ["No GSC impressions found for this article in the selected period."],
      startedAt: new Date(),
      completedAt: new Date(),
      metadata: toPrismaJson({ source: "google_search_console" })
    }
  });
}

function buildSearchConsoleLearnedRule(
  article: PublishedArticleRow,
  performance: {
    score: number;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
    topQuery: string | null;
  }
): string {
  const keyword = article.primaryKeyword ?? article.title ?? "this topic";
  if (performance.clicks > 0 || performance.score >= 70) {
    return `GSC shows ${keyword} can earn organic demand; reuse this pattern only with fresh intent, a different title promise, and supporting internal links.`;
  }
  if (performance.impressions > 0 && performance.ctr < 0.01) {
    return `GSC shows impressions but weak CTR for ${keyword}; improve title angle, meta description, and opening answer before creating similar topics.`;
  }
  return `GSC has not shown meaningful demand for ${keyword} yet; prioritize internal links, stronger search intent, and query-specific updates before repeating this angle.`;
}

function searchConsoleResult(
  job: SearchConsoleJob,
  data: SearchConsoleQueueJobData,
  message: string,
  counts: NonNullable<WorkerJobResult["counts"]>,
  articleId?: string
): WorkerJobResult {
  return {
    ok: true,
    queue: QUEUE_NAMES.seoPerformance,
    jobName: job.name,
    message,
    organizationId: data.organizationId,
    storeId: data.storeId,
    processedAt: new Date().toISOString(),
    counts,
    articleId
  };
}

function dateOnlyToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeMemoryTopic(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return normalized || undefined;
}

function hashStable(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
