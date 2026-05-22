import {
  assertArticlePublishAllowed,
  assertBrandVoiceAllowed,
  assertStoreSyncAllowed,
  assertTenantResource
} from "../policies/admin-policy";
import { exchangeShopifyClientCredentials, ShopifyGraphQLError } from "@shopify-ai-blog/shopify";
import { AdminApiError } from "../policies/errors";
import * as repository from "../repository/admin-repository";
import { syncShopifyStoreResources } from "./shopify-sync-service";
import { enqueuePublishJobForWorker } from "./worker-queue";
import type {
  AdminAiProviderOverview,
  AdminArticleOverview,
  AdminArticleReviewOverview,
  AdminArticleAssetOverview,
  AdminBrandVoiceProfile,
  AdminCampaignOverview,
  AdminLanguageOverview,
  AdminLogEntry,
  AdminMetric,
  AdminRequestContextInput,
  AdminStoreOverview,
  CreateCampaignInput,
  DeleteStoreInput,
  JobStatus,
  LogLevel,
  PublishEvent,
  QueueArticlePublishInput,
  QueueStoreSyncInput,
  QueuedJobSummary,
  ResolvedAdminContext,
  UpsertAiProviderInput,
  UpsertBrandVoiceInput,
  UpsertLanguageInput,
  UpsertStoreCredentialsInput
} from "../contracts";

type StoreRow = Awaited<ReturnType<typeof repository.findStores>>[number];
type CampaignRow = Awaited<ReturnType<typeof repository.findCampaigns>>[number];
type ArticleRow = Awaited<ReturnType<typeof repository.findArticles>>[number];
type ArticleReviewRow = NonNullable<Awaited<ReturnType<typeof repository.findArticleForReview>>>;
type AiProviderRow = Awaited<ReturnType<typeof repository.findAiProviderConfigs>>[number];
type BrandVoiceRow = Awaited<ReturnType<typeof repository.findBrandVoices>>[number];
type LocaleConfigRow = Awaited<ReturnType<typeof repository.findLocaleConfigs>>[number];
type PublishLogRow = Awaited<ReturnType<typeof repository.findRecentLogs>>["publishLogs"][number];
type AuditLogRow = Awaited<ReturnType<typeof repository.findRecentLogs>>["auditLogs"][number];
type DashboardStats = Awaited<ReturnType<typeof repository.getDashboardStats>>;
type QueuedJobRow = {
  id: string;
  type: QueuedJobSummary["type"];
  status: QueuedJobSummary["status"];
  runAt: Date;
  createdAt: Date;
};

export async function resolveAdminContext(input: AdminRequestContextInput): Promise<ResolvedAdminContext> {
  const organization = await repository.findOrganizationForAdmin(input.organizationSlug);

  if (!organization) {
    throw new AdminApiError(404, "ORGANIZATION_NOT_FOUND", "No active demo organization was found.");
  }

  return {
    ...input,
    organizationId: organization.id,
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      locale: organization.locale,
      timezone: organization.timezone,
      plan: organization.plan
    }
  };
}

export async function getDashboard(input: AdminRequestContextInput) {
  const context = await resolveAdminContext(input);
  const [stats, stores, campaigns, articles, logs] = await Promise.all([
    repository.getDashboardStats(context.organizationId),
    repository.findStores(context.organizationId, 5),
    repository.findCampaigns(context.organizationId, 5),
    repository.findPriorityArticles(context.organizationId, 8),
    repository.findRecentLogs(context.organizationId, 8)
  ]);

  return {
    organization: context.organization,
    metrics: mapMetrics(stats),
    stores: stores.map(mapStore),
    campaigns: campaigns.map(mapCampaign),
    articles: articles.map(mapArticle),
    logs: mergeAndMapLogs(logs.publishLogs, logs.auditLogs, context.organization.timezone).slice(0, 8)
  };
}

export async function getStores(input: AdminRequestContextInput) {
  const context = await resolveAdminContext(input);
  const stores = await repository.findStores(context.organizationId);

  return {
    organization: context.organization,
    stores: stores.map(mapStore)
  };
}

export async function saveStoreCredentials(input: AdminRequestContextInput, body: UpsertStoreCredentialsInput) {
  const context = await resolveAdminContext(input);
  const existing = await repository.findStoreByDomain(body.shopDomain);

  if (existing && existing.organizationId !== context.organizationId) {
    throw new AdminApiError(409, "STORE_DOMAIN_OWNED_BY_ANOTHER_ORG", "Store domain is already connected to another organization.");
  }

  const resolvedCredentials = await resolveStoreCredentialInput(body);
  const store = await repository.upsertStoreCredentials(context.organizationId, resolvedCredentials, context);

  return {
    organization: context.organization,
    store: mapStore({
      ...store,
      _count: {
        productSnapshots: 0,
        collectionSnapshots: 0,
        articles: 0,
        campaigns: 0
      }
    }),
    connected: true,
    connectionMode: resolvedCredentials.connectionMode,
    message:
      resolvedCredentials.connectionMode === "client_credentials"
        ? "Shopify client credentials were exchanged and encrypted."
        : "Store credentials were encrypted and saved."
  };
}

async function resolveStoreCredentialInput(input: UpsertStoreCredentialsInput): Promise<UpsertStoreCredentialsInput> {
  if (input.connectionMode === "manual_token") {
    if (!input.adminAccessToken) {
      throw new AdminApiError(400, "ADMIN_ACCESS_TOKEN_REQUIRED", "adminAccessToken is required.");
    }
    return input;
  }

  if (!input.shopifyClientId || !input.shopifyClientSecret) {
    throw new AdminApiError(400, "SHOPIFY_CLIENT_CREDENTIALS_REQUIRED", "clientId and clientSecret are required.");
  }

  try {
    const token = await exchangeShopifyClientCredentials({
      shop: input.shopDomain,
      clientId: input.shopifyClientId,
      clientSecret: input.shopifyClientSecret
    });

    if (!token.access_token) {
      throw new AdminApiError(502, "SHOPIFY_ACCESS_TOKEN_MISSING", "Shopify did not return an Admin API access token.");
    }

    const returnedScopes = parseShopifyScopeList(token.scope);

    return {
      ...input,
      adminAccessToken: token.access_token,
      adminAccessTokenExpiresAt: tokenExpiresAt(token.expires_in),
      scopes: returnedScopes.length > 0 ? returnedScopes : input.scopes
    };
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    throw new AdminApiError(502, "SHOPIFY_CLIENT_CREDENTIALS_EXCHANGE_FAILED", "Shopify could not exchange these client credentials for an Admin API token.", {
      shopDomain: input.shopDomain,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function parseShopifyScopeList(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope
    .split(/\s*,\s*|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenExpiresAt(expiresInSeconds: number | undefined): string | undefined {
  if (!Number.isFinite(expiresInSeconds) || !expiresInSeconds) return undefined;
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

export async function deleteStore(input: AdminRequestContextInput, body: DeleteStoreInput) {
  const context = await resolveAdminContext(input);
  const store = await repository.findStoreById(context.organizationId, body.storeId);

  if (!store) {
    throw new AdminApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  }

  assertTenantResource(store, context.organizationId, "store");

  if (body.confirmDomain && body.confirmDomain !== store.myshopifyDomain) {
    throw new AdminApiError(409, "STORE_DELETE_CONFIRMATION_MISMATCH", "Store confirmation domain does not match.", {
      storeId: store.id,
      confirmDomain: body.confirmDomain
    });
  }

  const deleted = await repository.deleteStore(context.organizationId, body, context);
  if (!deleted) {
    throw new AdminApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  }

  return {
    organization: context.organization,
    deleted: true,
    message: "Store was removed from this management system. Shopify store data outside this app was not deleted.",
    store: {
      id: deleted.id,
      name: deleted.name,
      domain: deleted.myshopifyDomain
    },
    removedCounts: deleted._count
  };
}

export async function getAiSettings(input: AdminRequestContextInput) {
  const context = await resolveAdminContext(input);
  const providers = await repository.findAiProviderConfigs(context.organizationId);

  return {
    organization: context.organization,
    providers: providers.map(mapAiProvider),
    defaultProvider: providers.find((provider: AiProviderRow) => provider.isDefault)?.id ?? null
  };
}

export async function getLanguages(input: AdminRequestContextInput) {
  const context = await resolveAdminContext(input);
  const localeConfigs = await repository.findLocaleConfigs(context.organizationId);

  return {
    organization: context.organization,
    languages: localeConfigs.map((config: LocaleConfigRow) => mapLanguage(config, context.organization.locale)),
    enabledLocales: Array.from(
      new Set(
        localeConfigs
          .filter((config: LocaleConfigRow) => config.isEnabled)
          .map((config: LocaleConfigRow) => config.locale)
      )
    )
  };
}

export async function getBrandVoice(input: AdminRequestContextInput) {
  const context = await resolveAdminContext(input);
  const profiles = await repository.findBrandVoices(context.organizationId);

  return {
    organization: context.organization,
    profiles: profiles.map(mapBrandVoice)
  };
}

export async function getCampaigns(input: AdminRequestContextInput) {
  const context = await resolveAdminContext(input);
  const campaigns = await repository.findCampaigns(context.organizationId);

  return {
    organization: context.organization,
    campaigns: campaigns.map(mapCampaign)
  };
}

export async function getArticles(input: AdminRequestContextInput) {
  const context = await resolveAdminContext(input);
  const articles = await repository.findArticles(context.organizationId);

  return {
    organization: context.organization,
    articles: articles.map(mapArticle)
  };
}

export async function getArticle(input: AdminRequestContextInput, articleId: string) {
  const context = await resolveAdminContext(input);
  const article = await repository.findArticleForReview(context.organizationId, articleId);

  if (!article) {
    throw new AdminApiError(404, "ARTICLE_NOT_FOUND", "Article was not found.");
  }

  return {
    organization: context.organization,
    article: mapArticleReview(article, context.organization.timezone)
  };
}

export async function getLogs(input: AdminRequestContextInput) {
  const context = await resolveAdminContext(input);
  const logs = await repository.findRecentLogs(context.organizationId);

  return {
    organization: context.organization,
    logs: mergeAndMapLogs(logs.publishLogs, logs.auditLogs, context.organization.timezone)
  };
}

export async function saveAiSettings(input: AdminRequestContextInput, body: UpsertAiProviderInput) {
  const context = await resolveAdminContext(input);
  await assertOptionalStore(context.organizationId, body.storeId);
  await repository.upsertAiProviderConfig(context.organizationId, body, context);
  return getAiSettings(context);
}

export async function saveLanguage(input: AdminRequestContextInput, body: UpsertLanguageInput) {
  const context = await resolveAdminContext(input);
  const store = await repository.findStoreById(context.organizationId, body.storeId);
  assertTenantResource(store, context.organizationId, "store");
  await repository.upsertLanguageConfig(context.organizationId, body, context);
  return getLanguages(context);
}

export async function saveBrandVoice(input: AdminRequestContextInput, body: UpsertBrandVoiceInput) {
  const context = await resolveAdminContext(input);
  await assertOptionalStore(context.organizationId, body.storeId);
  await repository.upsertBrandVoiceProfile(context.organizationId, body, context);
  return getBrandVoice(context);
}

export async function queueStoreSync(input: AdminRequestContextInput, body: QueueStoreSyncInput) {
  const context = await resolveAdminContext(input);
  const store = await repository.findStoreById(context.organizationId, body.storeId);

  if (!store) {
    throw new AdminApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  }

  assertStoreSyncAllowed(store, context.organizationId);

  if (!body.products && !body.collections) {
    throw new AdminApiError(400, "SYNC_TARGET_REQUIRED", "At least one sync target is required.");
  }

  let result: Awaited<ReturnType<typeof syncShopifyStoreResources>>;
  try {
    result = await syncShopifyStoreResources(context.organizationId, store, body, context);
  } catch (error) {
    await repository.recordStoreSyncFailure(context.organizationId, store.id, error, context);
    throw mapShopifySyncError(error);
  }

  return {
    organization: context.organization,
    synced: true,
    connectionVerified: true,
    syncMode: "immediate_shopify_graphql",
    message: "Shopify connection was verified and store resources were synced.",
    storeId: store.id,
    store: mapStore(result.store),
    counts: {
      products: result.productsSynced,
      collections: result.collectionsSynced,
      blogs: result.blogsSynced,
      articles: result.blogArticlesSynced,
      blogMappingsUpdated: result.blogMappingsUpdated
    },
    capped: {
      products: result.productsCapped,
      collections: result.collectionsCapped,
      articles: result.blogArticlesCapped
    }
  };
}

async function assertOptionalStore(organizationId: string, storeId: string | undefined) {
  if (!storeId) return;
  const store = await repository.findStoreById(organizationId, storeId);
  assertTenantResource(store, organizationId, "store");
}

export async function createCampaign(input: AdminRequestContextInput, body: CreateCampaignInput) {
  const context = await resolveAdminContext(input);
  const [store, localeConfigs, brandVoice] = await Promise.all([
    repository.findStoreById(context.organizationId, body.storeId),
    repository.findLocaleConfigs(context.organizationId),
    body.brandVoiceId ? repository.findBrandVoiceById(context.organizationId, body.brandVoiceId) : Promise.resolve(null)
  ]);

  if (!store) {
    throw new AdminApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  }

  assertTenantResource(store, context.organizationId, "store");
  assertBrandVoiceAllowed(brandVoice, context.organizationId, store.id);
  assertStoreLocaleEnabled(localeConfigs, store.id, body.locale);

  const result = await repository.createCampaignWithOptionalJob(context.organizationId, body, context);
  const workerJob = result.job ? await enqueueWorkerJobOrThrow(result.job, context) : null;

  return {
    organization: context.organization,
    campaign: mapCampaign(result.campaign),
    queued: Boolean(result.job),
    queueMode: workerJob ? "bullmq" : "none",
    workerQueue: workerJob ? "enqueued" : null,
    message: result.job
      ? "Campaign was created and generation was enqueued for worker execution."
      : "Campaign was created as a draft without a generation job.",
    job: result.job ? mapQueuedJob(result.job, "Campaign generation queued.") : null
  };
}

export async function queueArticlePublish(input: AdminRequestContextInput, body: QueueArticlePublishInput) {
  const context = await resolveAdminContext(input);
  const article = await repository.findArticleById(context.organizationId, body.articleId);

  if (!article) {
    throw new AdminApiError(404, "ARTICLE_NOT_FOUND", "Article was not found.");
  }

  assertArticlePublishAllowed(article, context.organizationId);

  const result = await repository.createArticlePublishJob(context.organizationId, body, context);
  if (!result) {
    throw new AdminApiError(404, "ARTICLE_NOT_FOUND", "Article was not found.");
  }
  await enqueueWorkerJobOrThrow(result.job, context);

  return {
    organization: context.organization,
    queued: true,
    queueMode: "bullmq",
    workerQueue: "enqueued",
    message: "Publish was enqueued for worker execution.",
    article: mapArticle(result.updatedArticle),
    job: mapQueuedJob(result.job, "Article publish queued.")
  };
}

async function enqueueWorkerJobOrThrow(
  job: Parameters<typeof enqueuePublishJobForWorker>[0],
  context: ResolvedAdminContext
) {
  try {
    const workerJob = await enqueuePublishJobForWorker(job, {
      requestedByUserId: context.requestedByUserId
    });
    await repository.markPublishJobEnqueued(job.id, workerJob.externalJobId);
    return workerJob;
  } catch (error) {
    const message = getErrorMessage(error);
    await repository.markPublishJobQueueFailed(job.id, message);
    throw new AdminApiError(
      503,
      "WORKER_QUEUE_UNAVAILABLE",
      "The task was saved, but the worker queue could not be reached. Please confirm Redis and the worker process are running.",
      {
        jobId: job.id,
        cause: message
      }
    );
  }
}

function mapMetrics(stats: DashboardStats): AdminMetric[] {
  const qualityRate =
    stats.generatedThisMonth === 0
      ? 0
      : Math.round((stats.qualityPassedThisMonth / stats.generatedThisMonth) * 100);
  const averageSeoScore = stats.averagePendingSeoScore ? Math.round(stats.averagePendingSeoScore) : 0;

  return [
    {
      label: "已连接店铺",
      value: String(stats.connectedStores),
      detail: `${stats.newStoresThisWeek} 个最近 7 天新增`,
      tone: "good"
    },
    {
      label: "本月生成文章",
      value: String(stats.generatedThisMonth),
      detail: `通过质量门槛 ${qualityRate}%`,
      tone: qualityRate >= 80 || stats.generatedThisMonth === 0 ? "good" : "warn"
    },
    {
      label: "待人工复核",
      value: String(stats.pendingManualReview),
      detail: averageSeoScore > 0 ? `平均 SEO 分 ${averageSeoScore}` : "暂无可计算 SEO 分",
      tone: stats.pendingManualReview > 0 ? "warn" : "good"
    },
    {
      label: "发布失败",
      value: String(stats.failedArticles + stats.failedJobs),
      detail: `${stats.failedArticles} 篇文章，${stats.failedJobs} 个任务`,
      tone: stats.failedArticles + stats.failedJobs > 0 ? "danger" : "good"
    }
  ];
}

function mapShopifySyncError(error: unknown): AdminApiError | unknown {
  if (error instanceof AdminApiError) return error;
  if (error instanceof ShopifyGraphQLError) {
    const details = {
      errors: error.errors,
      status: error.status
    };

    if (shopifyErrorsInclude(error.errors, "Access denied")) {
      return new AdminApiError(
        403,
        "SHOPIFY_SYNC_PERMISSION_DENIED",
        missingProductsScope(error.errors)
          ? "Shopify Admin API is missing the read_products scope for this app installation."
          : "Shopify Admin API permissions are missing for this sync target.",
        details
      );
    }

    return new AdminApiError(502, "SHOPIFY_GRAPHQL_ERROR", "Shopify GraphQL returned errors during sync.", details);
  }

  return error;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shopifyErrorsInclude(errors: unknown, pattern: string): boolean {
  return JSON.stringify(errors).toLowerCase().includes(pattern.toLowerCase());
}

function missingProductsScope(errors: unknown): boolean {
  const serialized = JSON.stringify(errors).toLowerCase();
  return serialized.includes("products field") || serialized.includes("\"products\"");
}

function mapStore(store: StoreRow): AdminStoreOverview {
  return {
    id: store.id,
    name: store.name,
    domain: store.myshopifyDomain,
    locale: store.primaryLocale,
    status: storeStatusLabel(store),
    statusCode: store.status,
    products: store._count.productSnapshots,
    collections: store._count.collectionSnapshots,
    articles: store._count.articles,
    campaigns: store._count.campaigns,
    lastSync: store.lastSyncedAt ? formatRelativeTime(store.lastSyncedAt) : "从未同步",
    lastSyncedAt: toIso(store.lastSyncedAt),
    apiVersion: store.apiVersion,
    scopes: store.scopes,
    hasAdminAccessToken: Boolean(store.adminAccessTokenEncrypted),
    shopOwnerEmail: store.shopOwnerEmail,
    currencyCode: store.currencyCode,
    timezone: store.timezone,
    updatedAt: store.updatedAt.toISOString()
  };
}

function mapCampaign(campaign: CampaignRow): AdminCampaignOverview {
  const progress = campaignProgressState(campaign);
  return {
    id: campaign.id,
    name: campaign.title,
    title: campaign.title,
    store: campaign.store.name,
    storeId: campaign.store.id,
    locale: campaign.locale,
    source: campaignSourceLabel(campaign),
    sourceType: campaign.sourceType,
    sourceId: campaign.sourceId,
    topic: campaign.topic,
    status: campaign.status,
    progress: progress.percent,
    progressLabel: progress.label,
    progressStep: progress.step,
    progressDetail: progress.detail,
    progressUpdatedAt: progress.updatedAt,
    publishPolicy: publishPolicyLabel(campaign.publishPolicy),
    publishPolicyCode: campaign.publishPolicy,
    targetWordCount: campaign.targetWordCount,
    primaryKeyword: campaign.primaryKeyword,
    keywords: campaign.keywords,
    articles: campaign.articles.length,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString()
  };
}

function mapArticle(article: ArticleRow): AdminArticleOverview {
  return {
    id: article.id,
    title: article.title ?? "Untitled article",
    handle: article.handle,
    store: article.store.name,
    storeId: article.store.id,
    campaignId: article.campaign?.id ?? null,
    campaign: article.campaign?.title ?? null,
    locale: article.locale,
    sourceType: article.sourceType,
    sourceId: article.sourceId,
    status: article.status,
    publishPolicy: article.publishPolicy,
    seoScore: Math.round(article.seoScore ?? 0),
    qualityPassed: article.qualityPassed,
    updatedAt: formatRelativeTime(article.updatedAt),
    updatedAtIso: article.updatedAt.toISOString(),
    publishedAt: toIso(article.publishedAt),
    canonicalUrl: article.canonicalUrl,
    primaryKeyword: article.primaryKeyword,
    failureReason: article.failureReason
  };
}

function mapArticleReview(article: ArticleReviewRow, timezone: string): AdminArticleReviewOverview {
  const generationMetadata = summarizeGenerationMetadata(article.generationMetadata);
  const structuredAgentTrace = summarizeStructuredAgentTrace(article, timezone);
  const enrichedGenerationMetadata =
    structuredAgentTrace
      ? {
          ...(generationMetadata ?? {}),
          structuredAgentTrace
        }
      : generationMetadata;

  return {
    ...mapArticle(article),
    summary: article.summary,
    bodyHtml: article.bodyHtml,
    secondaryKeywords: article.secondaryKeywords,
    tags: article.tags,
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
    shopifyBlogId: article.shopifyBlogId,
    shopifyArticleId: article.shopifyArticleId,
    scheduledAt: toIso(article.scheduledAt),
    lastGeneratedAt: toIso(article.lastGeneratedAt),
    qualityReport: article.qualityReport,
    generationMetadata: enrichedGenerationMetadata,
    assets: article.assets.map(mapArticleAsset),
    logs: article.publishLogs.map((log) => mapPublishLog(log, timezone))
  };
}

function summarizeStructuredAgentTrace(article: ArticleReviewRow, timezone: string) {
  const run = article.seoTopicRuns[0];
  if (!run) return null;

  return {
    runId: run.runId,
    status: run.status,
    agentVersion: run.agentVersion,
    objective: run.objective,
    selectedTopic: run.selectedTopic,
    startedAt: toIso(run.startedAt),
    completedAt: toIso(run.completedAt),
    stepCount: run.steps.length,
    toolCallCount: run.toolCalls.length,
    reflectionTaskCount: run.reflectionTasks.length,
    evidenceCount: run.evidenceItems.length,
    steps: run.steps.map((step) => ({
      id: step.id,
      sequence: step.sequence,
      type: step.stepType,
      key: step.stepKey,
      stage: step.stage,
      agentRole: step.agentRole,
      status: step.status,
      title: step.title,
      summary: step.summary,
      decision: step.decision,
      warnings: step.warnings,
      evidenceIds: step.evidenceIds,
      startedAt: toIso(step.startedAt),
      completedAt: toIso(step.completedAt),
      time: step.startedAt ? formatClock(step.startedAt, timezone) : null,
      latencyMs: step.latencyMs,
      metadata: step.metadata
    })),
    toolCalls: run.toolCalls.map((call) => ({
      id: call.id,
      stage: call.stage,
      agentRole: call.agentRole,
      toolName: call.toolName,
      status: call.status,
      warnings: call.warnings,
      startedAt: toIso(call.startedAt),
      completedAt: toIso(call.completedAt),
      latencyMs: call.latencyMs,
      metadata: call.metadata
    })),
    reflectionTasks: run.reflectionTasks.map((task) => ({
      id: task.id,
      priority: task.priority,
      agentRole: task.agentRole,
      instruction: task.instruction,
      acceptanceCheck: task.acceptanceCheck,
      status: task.status,
      evidenceIds: task.evidenceIds,
      createdAt: task.createdAt.toISOString(),
      resolvedAt: toIso(task.resolvedAt)
    })),
    evidence: run.evidenceItems.map((evidence) => ({
      id: evidence.id,
      type: evidence.evidenceType,
      source: evidence.source,
      value: evidence.value,
      url: evidence.url,
      confidence: evidence.confidence,
      relevanceScore: evidence.relevanceScore,
      createdAt: evidence.createdAt.toISOString()
    }))
  };
}

function summarizeGenerationMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const provider = asRecord(record.provider);
  const ai = asRecord(record.ai);
  const contentEngine = asRecord(record.contentEngine);
  const finalQuality = asRecord(contentEngine.finalQuality);
  const finalSeo = asRecord(contentEngine.finalSeo);
  const artifacts = asRecord(contentEngine.artifacts);
  const keywords = asRecord(artifacts.keywords);
  const imageAsset = asRecord(record.imageAsset);
  const aiSearchReview = record.aiSearchReview ?? contentEngine.aiSearchReview ?? finalQuality.aiSearchReview ?? null;
  const seoAgent = record.seoAgent ?? artifacts.agentRun ?? null;

  return {
    generator: stringValue(record.generator),
    provider: {
      name: stringValue(provider.provider),
      baseUrl: stringValue(provider.baseUrl),
      textModel: stringValue(provider.textModel),
      imageModel: stringValue(provider.imageModel)
    },
    ai: {
      model: stringValue(ai.model),
      finishReason: stringValue(ai.finishReason),
      usage: ai.usage ?? null
    },
    aiSearchReview,
    seoAgent,
    topicSelection: artifacts.topicSelection ?? null,
    topicSelectionV2: artifacts.topicSelectionV2 ?? null,
    contentBrief: artifacts.contentBrief ?? null,
    reflection: artifacts.reflection ?? null,
    keywordEvidence: artifacts.keywordEvidence ?? keywords.evidenceItems ?? keywords.evidence ?? null,
    image: Object.keys(imageAsset).length
      ? {
          publicUrl: stringValue(imageAsset.publicUrl),
          sourceUrl: stringValue(imageAsset.sourceUrl),
          altText: stringValue(imageAsset.altText),
          error: stringValue(imageAsset.error),
          referenceImageUrls: imageAsset.referenceImageUrls ?? null
        }
      : null,
    quality: {
      passed: typeof finalQuality.passed === "boolean" ? finalQuality.passed : null,
      seoScore: typeof finalSeo.score === "number" ? finalSeo.score : null,
      wordCount: typeof finalQuality.wordCount === "number" ? finalQuality.wordCount : null
    }
  };
}

function mapArticleAsset(asset: ArticleReviewRow["assets"][number]): AdminArticleAssetOverview {
  return {
    id: asset.id,
    type: asset.type,
    status: asset.status,
    publicUrl: asset.publicUrl,
    sourceUrl: asset.sourceUrl,
    altText: asset.altText,
    prompt: asset.prompt,
    createdAt: asset.createdAt.toISOString()
  };
}

function mapAiProvider(provider: AiProviderRow): AdminAiProviderOverview {
  return {
    id: provider.id,
    slug: provider.slug,
    name: provider.name,
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    textModel: provider.textModel,
    imageModel: provider.imageModel,
    temperature: provider.temperature,
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    storeId: provider.store?.id ?? null,
    store: provider.store?.name ?? null,
    hasApiKey: Boolean(provider.apiKeyEncrypted),
    apiKeyMasked: provider.apiKeyEncrypted ? "sk-••••••••••••••••" : null,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString()
  };
}

function mapLanguage(config: LocaleConfigRow, fallback: string): AdminLanguageOverview {
  return {
    id: config.id,
    locale: config.locale,
    label: config.label,
    enabled: config.isEnabled,
    fallback,
    role: languageRole(config),
    isDefault: config.isDefault,
    storeId: config.store.id,
    store: config.store.name,
    shopifyMarketHandle: config.shopifyMarketHandle,
    shopifyBlogId: config.shopifyBlogId,
    shopifyBlogHandle: config.shopifyBlogHandle
  };
}

function mapBrandVoice(profile: BrandVoiceRow): AdminBrandVoiceProfile {
  return {
    id: profile.id,
    locale: profile.locale,
    name: profile.name,
    storeId: profile.store?.id ?? null,
    store: profile.store?.name ?? null,
    audience: profile.audience,
    tone: profile.tone,
    bannedWords: profile.bannedWords,
    examples: profile.examples,
    isDefault: profile.isDefault,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString()
  };
}

function mergeAndMapLogs(publishLogs: PublishLogRow[], auditLogs: AuditLogRow[], timezone: string): AdminLogEntry[] {
  return [
    ...publishLogs.map((log) => mapPublishLog(log, timezone)),
    ...auditLogs.map((log) => mapAuditLog(log, timezone))
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function mapPublishLog(log: PublishLogRow, timezone: string): AdminLogEntry {
  return {
    id: log.id,
    time: formatClock(log.createdAt, timezone),
    createdAt: log.createdAt.toISOString(),
    level: mapLogLevel(log.level),
    module: moduleFromJobType(log.job?.type ?? "publish_article"),
    message: log.message,
    status: log.job?.status ?? statusFromPublishEvent(log.event),
    source: "publish",
    storeId: log.storeId,
    articleId: log.articleId,
    jobId: log.jobId
  };
}

function mapAuditLog(log: AuditLogRow, timezone: string): AdminLogEntry {
  return {
    id: log.id,
    time: formatClock(log.createdAt, timezone),
    createdAt: log.createdAt.toISOString(),
    level: log.action === "delete" ? "warning" : "info",
    module: moduleFromAudit(log.action, log.entityType),
    message: auditMessage(log.action, log.entityType),
    status: "succeeded",
    source: "audit",
    storeId: log.storeId,
    articleId: log.entityType === "blog_article" ? log.entityId : null,
    jobId: null
  };
}

function mapQueuedJob(job: QueuedJobRow, message: string): QueuedJobSummary {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    runAt: job.runAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    message
  };
}

function assertStoreLocaleEnabled(localeConfigs: LocaleConfigRow[], storeId: string, locale: string) {
  const config = localeConfigs.find((item) => item.storeId === storeId && item.locale === locale);

  if (!config) {
    throw new AdminApiError(409, "LOCALE_NOT_CONFIGURED", "Locale is not configured for this store.", {
      storeId,
      locale
    });
  }

  if (!config.isEnabled) {
    throw new AdminApiError(409, "LOCALE_DISABLED", "Locale is disabled for this store.", {
      storeId,
      locale
    });
  }
}

function storeStatusLabel(store: { status: string; adminAccessTokenEncrypted: string | null }) {
  if (store.status === "active" && store.adminAccessTokenEncrypted) return "已连接";
  if (store.status === "active") return "已连接";
  if (store.status === "installing") return "同步中";
  return "需授权";
}

function campaignSourceLabel(campaign: { sourceType: string; sourceId: string | null; topic: string | null }) {
  if (campaign.sourceType === "manual_topic") return campaign.topic ? `Manual: ${campaign.topic}` : "Manual topics";
  if (campaign.sourceType === "collection") return `Collection: ${campaign.sourceId ?? "unselected"}`;
  return `Product: ${campaign.sourceId ?? "unselected"}`;
}

function campaignProgressState(campaign: { status: string; metadata?: unknown; articles: Array<{ status: string }> }) {
  const metadata = asRecord(campaign.metadata);
  const progress = asRecord(metadata.generationProgress);
  const percent = numberValue(progress.percent);
  const label = stringValue(progress.label);
  const step = stringValue(progress.step);
  const detail = stringValue(progress.detail);
  const updatedAt = stringValue(progress.updatedAt);

  if (campaign.status === "active" && typeof percent === "number") {
    return {
      percent,
      label: label ?? campaignProgressLabel(step, campaign.status),
      step,
      detail,
      updatedAt
    };
  }

  const fallbackPercent = campaignProgress(campaign);
  return {
    percent: fallbackPercent,
    label: campaignProgressLabel(step, campaign.status),
    step,
    detail,
    updatedAt
  };
}

function campaignProgress(campaign: { status: string; articles: Array<{ status: string }> }) {
  if (campaign.status === "completed") return 100;
  if (campaign.status === "failed") return 0;
  if (campaign.articles.length === 0) return campaign.status === "active" ? 10 : 0;

  const score = campaign.articles.reduce((total, article) => {
    switch (article.status) {
      case "published":
        return total + 100;
      case "publishing":
        return total + 85;
      case "ready_to_publish":
        return total + 75;
      case "quality_failed":
      case "failed":
        return total + 40;
      case "draft":
      default:
        return total + 25;
    }
  }, 0);

  return Math.min(100, Math.round(score / campaign.articles.length));
}

function campaignProgressLabel(step: string | null, status: string) {
  if (status === "completed") return "已完成";
  if (status === "failed") return "生成失败";

  switch (step) {
    case "article:queued":
      return "任务已进入队列";
    case "context:loaded":
      return "已读取店铺与任务上下文";
    case "input:validated":
      return "任务参数已校验";
    case "job:started":
      return "生成任务已启动";
    case "research:running":
      return "正在研究选题和关键词";
    case "brief:completed":
      return "内容简报已完成";
    case "ai:drafting":
      return "AI 正在撰写正文";
    case "ai:draft_completed":
      return "正文初稿已完成";
    case "ai:reviewing":
      return "AI 正在评分";
    case "ai:final_review":
      return "正在复核配图后的文章";
    case "image:generating":
      return "正在生成配图";
    case "quality:finalizing":
      return "正在计算质量门槛";
    case "article:saving":
      return "正在保存文章";
    case "article:saved":
      return "文章已保存";
    case "agent:metadata_saved":
      return "Agent 记录已保存";
    case "assets:saved":
      return "图片记录已保存";
    case "article:uploading_images":
      return "正在上传图片到 Shopify";
    case "article:generated":
      return "文章生成完成";
    default:
      if (step?.startsWith("ai:revision_")) return "AI 正在按评分建议改稿";
      if (step?.startsWith("ai:final_revision_")) return "AI 正在最终改稿";
      return status === "active" ? "正在执行" : "未开始";
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : undefined;
}

function publishPolicyLabel(policy: string) {
  switch (policy) {
    case "auto_when_qualified":
      return "达标自动发布";
    case "manual_review":
      return "人工复核";
    case "direct":
      return "直接发布";
    default:
      return policy;
  }
}

function languageRole(config: { isDefault: boolean; isEnabled: boolean }) {
  if (config.isDefault) return "默认 UI 与内容语言";
  if (config.isEnabled) return "内容生成语言";
  return "内容语言预留";
}

function mapLogLevel(level: LogLevel): AdminLogEntry["level"] {
  if (level === "warn") return "warning";
  return level;
}

function statusFromPublishEvent(event: PublishEvent): JobStatus {
  switch (event) {
    case "queued":
      return "queued";
    case "started":
      return "running";
    case "succeeded":
      return "succeeded";
    case "retry_scheduled":
      return "retrying";
    case "failed":
    case "skipped":
    default:
      return "failed";
  }
}

function moduleFromJobType(type: string) {
  if (type === "sync_product" || type === "sync_collection") return "shopify";
  if (type === "publish_article") return "publisher";
  if (type === "generate_article" || type === "translate_article" || type === "generate_asset") return "content-engine";
  return "admin";
}

function moduleFromAudit(action: string, entityType: string) {
  if (action === "sync" || entityType === "shopify_store") return "shopify";
  if (action === "publish" || entityType === "blog_article") return "publisher";
  if (entityType === "blog_campaign") return "content-engine";
  return "admin";
}

function auditMessage(action: string, entityType: string) {
  return `${entityType} ${action}`;
}

function formatRelativeTime(date: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "刚刚";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;

  return date.toISOString().slice(0, 10);
}

function formatClock(date: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 19);
  }
}

function toIso(date: Date | null) {
  return date ? date.toISOString() : null;
}
