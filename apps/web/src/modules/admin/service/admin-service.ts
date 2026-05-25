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
  AdminArticleIndexReadiness,
  AdminArticleReviewOverview,
  AdminArticleSeoPerformanceOverview,
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
  AdminSearchConsolePropertyOverview,
  AdminSearchConsoleSnapshotOverview,
  AdminSearchConsoleView,
  AdminPriorityBoardItem,
  AdminPriorityBoardSummary,
  AdminPriorityBoardView,
  AdminCampaignDraft,
  AdminPriorityKind,
  AdminPriorityLevel,
  AdminPerformanceReviewItem,
  AdminPerformanceReviewSummary,
  AdminPerformanceReviewView,
  AdminResearchCluster,
  AdminResearchMode,
  AdminResearchPerformanceMatrixItem,
  AdminResearchSignal,
  AdminPriorityActionType,
  AdminResearchTopicRunAction,
  AdminResearchView,
  AdminResearchTrend,
  QueueArticlePublishInput,
  QueueArticleRepairInput,
  QueueSearchConsoleArticleSyncInput,
  QueueSearchConsoleSyncInput,
  QueueStoreSyncInput,
  QueuedJobSummary,
  ResolvedAdminContext,
  UpsertAiProviderInput,
  UpsertBrandVoiceInput,
  UpsertLanguageInput,
  UpsertStoreCredentialsInput,
  SaveSearchConsolePropertyInput
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
type SearchConsolePropertyRow = Awaited<ReturnType<typeof repository.findSearchConsoleProperties>>[number];
type SearchConsoleSnapshotRow = Awaited<ReturnType<typeof repository.findSearchConsoleSnapshots>>[number];
type PriorityArticleRow = Awaited<ReturnType<typeof repository.findPriorityDashboardArticles>>[number];
type PriorityTopicRunRow = Awaited<ReturnType<typeof repository.findPriorityDashboardTopicRuns>>[number];
type PriorityMemoryRow = Awaited<ReturnType<typeof repository.findPriorityDashboardMemories>>[number];
type PriorityReflectionTaskRow = Awaited<ReturnType<typeof repository.findPriorityDashboardReflectionTasks>>[number];
type PriorityStepRow = Awaited<ReturnType<typeof repository.findPriorityDashboardSteps>>[number];
type PerformanceReviewSnapshotRow = Awaited<ReturnType<typeof repository.findPerformanceReviewSnapshots>>[number];
type PerformanceReviewQueryRow = Awaited<ReturnType<typeof repository.findPerformanceReviewQueryRows>>[number];
type QueuedJobRow = {
  id: string;
  type: QueuedJobSummary["type"];
  status: QueuedJobSummary["status"];
  runAt: Date;
  createdAt: Date;
};

const ACTIVE_CAMPAIGN_STALE_MINUTES = 12;

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
    queueHealth: mapQueueHealth(stats),
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

export async function getSearchConsole(input: AdminRequestContextInput): Promise<AdminSearchConsoleView & { organization: ResolvedAdminContext["organization"] }> {
  const context = await resolveAdminContext(input);
  const [properties, snapshots, stores] = await Promise.all([
    repository.findSearchConsoleProperties(context.organizationId),
    repository.findSearchConsoleSnapshots(context.organizationId),
    repository.findStores(context.organizationId)
  ]);

  return {
    organization: context.organization,
    properties: properties.map((property) => mapSearchConsoleProperty(property)),
    snapshots: snapshots.map((snapshot) => mapSearchConsoleSnapshot(snapshot)),
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      domain: store.myshopifyDomain,
      publishedSiteUrl: publishedSiteUrlFromStore(store),
      defaultSiteUrl: toUrlPrefixSiteUrl(publishedSiteUrlFromStore(store))
    }))
  };
}

export async function getPriorities(input: AdminRequestContextInput): Promise<AdminPriorityBoardView> {
  const context = await resolveAdminContext(input);
  const [articles, topicRuns, memories, reflectionTasks, steps, searchConsole] = await Promise.all([
    repository.findPriorityDashboardArticles(context.organizationId, 80),
    repository.findPriorityDashboardTopicRuns(context.organizationId, 50),
    repository.findPriorityDashboardMemories(context.organizationId, 80),
    repository.findPriorityDashboardReflectionTasks(context.organizationId, 80),
    repository.findPriorityDashboardSteps(context.organizationId, 80),
    repository.findSearchConsoleSnapshots(context.organizationId, 80)
  ]);
  const localeFallbacks = await getLocaleFallbacks(context.organizationId);

  const items = buildPriorityBoardItems({
    articles,
    topicRuns,
    memories,
    reflectionTasks,
    steps,
    searchConsole,
    timezone: context.organization.timezone,
    localeFallbacks,
    defaultLocale: context.organization.locale
  });

  return {
    organization: context.organization,
    generatedAt: new Date().toISOString(),
    summary: summarizePriorityBoard(items),
    items
  };
}

export async function getPerformanceReview(input: AdminRequestContextInput): Promise<AdminPerformanceReviewView> {
  const context = await resolveAdminContext(input);
  const [snapshots, queryRows, memories, steps, topicRuns] = await Promise.all([
    repository.findPerformanceReviewSnapshots(context.organizationId, 120),
    repository.findPerformanceReviewQueryRows(context.organizationId, 260),
    repository.findPriorityDashboardMemories(context.organizationId, 80),
    repository.findPriorityDashboardSteps(context.organizationId, 80),
    repository.findPriorityDashboardTopicRuns(context.organizationId, 50)
  ]);
  const localeFallbacks = await getLocaleFallbacks(context.organizationId);

  const items = buildPerformanceReviewItems({
    snapshots,
    queryRows,
    memories,
    steps,
    topicRuns,
    timezone: context.organization.timezone,
    localeFallbacks,
    defaultLocale: context.organization.locale
  });

  return {
    organization: context.organization,
    generatedAt: new Date().toISOString(),
    summary: summarizePerformanceReview(items),
    items
  };
}

export async function getResearch(input: AdminRequestContextInput, mode: AdminResearchMode = "overview"): Promise<AdminResearchView> {
  const context = await resolveAdminContext(input);
  const [articles, topicRuns, memories, reflectionTasks, steps, searchConsole, snapshots, queryRows, campaigns, properties] =
    await Promise.all([
      repository.findPriorityDashboardArticles(context.organizationId, 80),
      repository.findPriorityDashboardTopicRuns(context.organizationId, 50),
      repository.findPriorityDashboardMemories(context.organizationId, 80),
      repository.findPriorityDashboardReflectionTasks(context.organizationId, 80),
      repository.findPriorityDashboardSteps(context.organizationId, 80),
      repository.findSearchConsoleSnapshots(context.organizationId, 80),
      repository.findPerformanceReviewSnapshots(context.organizationId, 120),
      repository.findPerformanceReviewQueryRows(context.organizationId, 260),
      repository.findCampaigns(context.organizationId, 60),
      repository.findSearchConsoleProperties(context.organizationId, 50)
    ]);
  const localeFallbacks = await getLocaleFallbacks(context.organizationId);

  const priorityItems = buildPriorityBoardItems({
    articles,
    topicRuns,
    memories,
    reflectionTasks,
    steps,
    searchConsole,
    timezone: context.organization.timezone,
    localeFallbacks,
    defaultLocale: context.organization.locale
  });
  const performanceItems = buildPerformanceReviewItems({
    snapshots,
    queryRows,
    memories,
    steps,
    topicRuns,
    timezone: context.organization.timezone,
    localeFallbacks,
    defaultLocale: context.organization.locale
  });
  const signals = dedupeResearchSignals([
    ...priorityItems.map(priorityItemToResearchSignal),
    ...performanceItems.map(performanceItemToResearchSignal),
    ...buildResearchSignalsFromSearchConsole(searchConsole, campaigns)
  ]).sort((left, right) => right.score - left.score);
  const clusters = buildResearchClusters(priorityItems, performanceItems, searchConsole, campaigns);
  const trends = buildResearchTrends(performanceItems, searchConsole);
  const performanceMatrix = buildResearchPerformanceMatrix(performanceItems, searchConsole, snapshots);
  const topicRunActions = buildTopicRunActions(topicRuns, performanceItems);

  return {
    organization: context.organization,
    generatedAt: new Date().toISOString(),
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
      topicRuns: performanceItems.length,
      searchConsoleProperties: properties.length
    },
    signals,
    clusters,
    trends,
    performanceMatrix,
    topicRunActions,
    topicRuns: performanceItems,
    notes: buildResearchNotes({
      campaigns,
      properties,
      priorityItems,
      performanceItems,
      topicRuns,
      searchConsole
    })
  };
}

export async function saveSearchConsoleProperty(input: AdminRequestContextInput, body: SaveSearchConsolePropertyInput) {
  const context = await resolveAdminContext(input);
  const store = await repository.findStoreById(context.organizationId, body.storeId);
  if (!store) {
    throw new AdminApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  }

  assertTenantResource(store, context.organizationId, "store");

  await repository.upsertSearchConsoleProperty(
    context.organizationId,
    {
      id: body.id,
      storeId: body.storeId,
      siteUrl: body.siteUrl,
      status: body.status,
      permissionLevel: body.permissionLevel,
      scopes: body.scopes,
      googleClientId: body.googleClientId,
      googleClientSecret: body.googleClientSecret,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      tokenExpiresAt: body.tokenExpiresAt
    },
    context
  );

  return getSearchConsole(context);
}

export async function queueSearchConsoleSync(input: AdminRequestContextInput, body: QueueSearchConsoleSyncInput) {
  const context = await resolveAdminContext(input);
  const store = await repository.findStoreById(context.organizationId, body.storeId);
  if (!store) {
    throw new AdminApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  }

  const property = body.propertyId
    ? await repository.findSearchConsolePropertyById(context.organizationId, body.propertyId)
    : await repository.findActiveSearchConsoleProperty(context.organizationId, body.storeId);

  if (!property) {
    throw new AdminApiError(404, "SEARCH_CONSOLE_PROPERTY_NOT_FOUND", "Search Console property was not found.");
  }
  if (property.storeId !== body.storeId) {
    throw new AdminApiError(409, "SEARCH_CONSOLE_PROPERTY_STORE_MISMATCH", "Search Console property does not belong to this store.", {
      storeId: body.storeId,
      propertyId: property.id
    });
  }

  const job = await repository.createSearchConsoleSyncJob(context.organizationId, {
    storeId: body.storeId,
    propertyId: property.id,
    startDate: body.startDate,
    endDate: body.endDate,
    days: body.days,
    dataState: body.dataState,
    rowLimit: body.rowLimit
  }, context);
  if (!job) {
    throw new AdminApiError(404, "SEARCH_CONSOLE_PROPERTY_NOT_FOUND", "Search Console property was not found.");
  }

  await enqueueWorkerJobOrThrow(job, context);

  return {
    organization: context.organization,
    queued: true,
    queueMode: "bullmq",
    workerQueue: "enqueued",
    message: "Search Console store sync request recorded.",
    job: mapQueuedJob(job, "Search Console sync queued.")
  };
}

export async function queueSearchConsoleArticleSync(input: AdminRequestContextInput, body: QueueSearchConsoleArticleSyncInput & { articleId: string }) {
  const context = await resolveAdminContext(input);
  const article = await repository.findArticleById(context.organizationId, body.articleId);
  if (!article) {
    throw new AdminApiError(404, "ARTICLE_NOT_FOUND", "Article was not found.");
  }

  const property = body.propertyId
    ? await repository.findSearchConsolePropertyById(context.organizationId, body.propertyId)
    : await repository.findActiveSearchConsoleProperty(context.organizationId, article.storeId);

  if (!property) {
    throw new AdminApiError(404, "SEARCH_CONSOLE_PROPERTY_NOT_FOUND", "Search Console property was not found.");
  }
  if (property.storeId !== article.storeId) {
    throw new AdminApiError(409, "SEARCH_CONSOLE_PROPERTY_STORE_MISMATCH", "Search Console property does not belong to this article's store.", {
      storeId: article.storeId,
      propertyId: property.id
    });
  }

  const job = await repository.createSearchConsoleArticleSyncJob(context.organizationId, {
    storeId: article.storeId,
    articleId: article.id,
    propertyId: property.id,
    startDate: body.startDate,
    endDate: body.endDate,
    days: body.days,
    dataState: body.dataState,
    rowLimit: body.rowLimit
  }, context);
  if (!job) {
    throw new AdminApiError(404, "SEARCH_CONSOLE_SYNC_TARGET_NOT_FOUND", "Search Console property or article was not found.");
  }

  await enqueueWorkerJobOrThrow(job, context);

  return {
    organization: context.organization,
    queued: true,
    queueMode: "bullmq",
    workerQueue: "enqueued",
    message: "Search Console article sync request recorded.",
    job: mapQueuedJob(job, "Search Console article sync queued."),
    articleId: article.id
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

export async function queueArticleRepair(input: AdminRequestContextInput, body: QueueArticleRepairInput) {
  const context = await resolveAdminContext(input);
  const article = await repository.findArticleById(context.organizationId, body.articleId);

  if (!article) {
    throw new AdminApiError(404, "ARTICLE_NOT_FOUND", "Article was not found.");
  }

  const result = await repository.createArticleRepairJob(context.organizationId, body, context);
  if (!result) {
    throw new AdminApiError(404, "ARTICLE_NOT_FOUND", "Article was not found.");
  }
  await enqueueWorkerJobOrThrow(result.job, context);

  return {
    organization: context.organization,
    queued: true,
    queueMode: "bullmq",
    workerQueue: "enqueued",
    message: "AI article repair was enqueued for worker execution.",
    article: mapArticle(result.updatedArticle),
    job: mapQueuedJob(result.job, "Article repair queued.")
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

function mapQueueHealth(stats: DashboardStats) {
  const activeJobs = stats.runningJobs + stats.retryingJobs;
  const pendingJobs = stats.queuedJobs + activeJobs;
  const failedJob = stats.latestFailedJob;
  let tone: "good" | "warn" | "danger" | "neutral" = "good";
  let label = "队列空闲";
  let nextStep = "可以直接开始新任务。";

  if (stats.failedJobs > 0) {
    tone = "danger";
    label = "有失败任务";
    nextStep = "先看失败原因，再重新排队或修复文章。";
  } else if (activeJobs > 0) {
    tone = stats.runningJobs > 0 ? "warn" : "neutral";
    label = stats.runningJobs > 0 ? "任务正在执行" : "任务正在重试";
    nextStep = "等待 worker 继续执行，必要时去文章页看最新状态。";
  } else if (stats.queuedJobs > 0) {
    tone = "warn";
    label = "任务已排队";
    nextStep = "worker 正在取队列，先看文章和日志是否有更新。";
  }

  return {
    queuedJobs: stats.queuedJobs,
    runningJobs: stats.runningJobs,
    retryingJobs: stats.retryingJobs,
    failedJobs: stats.failedJobs,
    activeJobs,
    pendingJobs,
    tone,
    label,
    nextStep,
    lastFailedJobId: failedJob?.id ?? null,
    lastFailedJobType: failedJob?.type ?? null,
    lastFailedAt: failedJob?.updatedAt.toISOString() ?? null,
    lastFailedMessage: failedJob?.errorMessage ?? null
  };
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

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
    progressStage: progress.stage,
    progressNextStep: progress.nextStep,
    progressRecoverable: progress.recoverable,
    progressArticleId: progress.articleId,
    progressIsStale: progress.isStale,
    progressStaleMinutes: progress.staleMinutes,
    progressStaleReason: progress.staleReason,
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
  const indexReadiness = buildArticleIndexReadiness(article);

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
    failureReason: article.failureReason,
    indexReadiness
  };
}

function buildArticleIndexReadiness(article: {
  status: string;
  seoScore: number | null;
  qualityPassed: boolean;
  canonicalUrl: string | null;
  publishedAt: Date | null;
  shopifyArticleId: string | null;
  seoPerformanceSnapshots?: Array<{ syncedAt: Date }>;
}): AdminArticleIndexReadiness {
  const latestSearchConsoleSync = article.seoPerformanceSnapshots?.[0]?.syncedAt ?? null;
  const checks = [
    {
      key: "content_quality" as const,
      label: "内容过线",
      passed: article.qualityPassed && (article.seoScore ?? 0) >= 82,
      detail: article.qualityPassed
        ? (article.seoScore ?? 0) >= 82
          ? `SEO ${Math.round(article.seoScore ?? 0)}，内容质量已通过。`
          : `质量门禁通过，但 SEO ${Math.round(article.seoScore ?? 0)} 还低于 82，建议继续修复。`
        : "内容还没有通过质量门禁，先 AI 修复。"
    },
    {
      key: "published_url" as const,
      label: "已上线",
      passed: article.status === "published" && Boolean(article.publishedAt || article.shopifyArticleId),
      detail:
        article.status === "published"
          ? "Shopify 已返回已发布状态。"
          : article.status === "ready_to_publish"
            ? "文章已准备好，下一步是发布到 Shopify。"
            : "文章还没有发布到线上店铺。"
    },
    {
      key: "canonical_url" as const,
      label: "Canonical",
      passed: Boolean(article.canonicalUrl),
      detail: article.canonicalUrl ? "线上规范 URL 已保存。" : "发布成功后系统会保存 canonical URL。"
    },
    {
      key: "search_console" as const,
      label: "搜索同步",
      passed: Boolean(latestSearchConsoleSync),
      detail: latestSearchConsoleSync ? "已有 Search Console 同步记录。" : "发布后同步 Search Console，继续看抓取和表现。"
    }
  ];
  const passedCount = checks.filter((check) => check.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);

  if (!checks[0].passed) {
    return {
      score,
      label: "先修复内容",
      tone: "danger",
      nextStep: "点 AI 修复，让文章重新过内容、引用、内链和 SEO 质检。",
      checks,
      lastSearchConsoleSyncAt: toIso(latestSearchConsoleSync)
    };
  }

  if (!checks[1].passed) {
    return {
      score,
      label: "待发布",
      tone: "warn",
      nextStep: "发布到 Shopify 后，Google 才能抓取线上页面。",
      checks,
      lastSearchConsoleSyncAt: toIso(latestSearchConsoleSync)
    };
  }

  if (!checks[2].passed) {
    return {
      score,
      label: "待确认链接",
      tone: "warn",
      nextStep: "确认线上页面和 canonical URL，再同步搜索表现。",
      checks,
      lastSearchConsoleSyncAt: toIso(latestSearchConsoleSync)
    };
  }

  if (!checks[3].passed) {
    return {
      score,
      label: "可被发现",
      tone: "good",
      nextStep: "页面已上线并有 canonical，下一步同步 Search Console 看抓取信号。",
      checks,
      lastSearchConsoleSyncAt: toIso(latestSearchConsoleSync)
    };
  }

  return {
    score,
    label: "监控表现",
    tone: "good",
    nextStep: "继续观察曝光、排名和 CTR，表现弱时进入复盘。",
    checks,
    lastSearchConsoleSyncAt: toIso(latestSearchConsoleSync)
  };
}

function mapArticleReview(article: ArticleReviewRow, timezone: string): AdminArticleReviewOverview {
  const generationMetadata = summarizeGenerationMetadata(article.generationMetadata);
  const structuredAgentTrace = summarizeStructuredAgentTrace(article, timezone);
  const brandVoice = summarizeBrandVoice(
    article.campaign?.brandVoice,
    asRecord(generationMetadata?.brandVoice),
    asRecord(article.generationMetadata)
  );
  const enrichedGenerationMetadata =
    structuredAgentTrace
      ? {
          ...(generationMetadata ?? {}),
          structuredAgentTrace,
          ...(brandVoice ? { brandVoice } : {})
        }
      : {
          ...(generationMetadata ?? {}),
          ...(brandVoice ? { brandVoice } : {})
        };

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
    logs: article.publishLogs.map((log) => mapPublishLog(log, timezone)),
    repairJob: mapArticleRepairJob(article),
    seoPerformance: mapArticleSeoPerformance(article.seoPerformanceSnapshots?.[0] ?? null)
  };
}

function mapArticleSeoPerformance(
  snapshot: ArticleReviewRow["seoPerformanceSnapshots"][number] | null | undefined
): AdminArticleSeoPerformanceOverview | null {
  if (!snapshot) return null;
  const queries = (snapshot.queryRows ?? []).map((query) => ({
    query: query.query,
    clicks: query.clicks,
    impressions: query.impressions,
    ctr: query.ctr,
    position: query.position,
    opportunity: searchConsoleQueryOpportunity(query)
  }));

  return {
    snapshotId: snapshot.id,
    propertyId: snapshot.property.id,
    siteUrl: snapshot.property.siteUrl,
    pageUrl: snapshot.pageUrl,
    startDate: snapshot.startDate.toISOString(),
    endDate: snapshot.endDate.toISOString(),
    dataState: snapshot.dataState,
    clicks: snapshot.clicks,
    impressions: snapshot.impressions,
    ctr: snapshot.ctr,
    position: snapshot.position,
    queryCount: snapshot.queryCount,
    topQuery: snapshot.topQuery,
    performanceScore: snapshot.performanceScore,
    syncedAt: snapshot.syncedAt.toISOString(),
    queries,
    recommendations: buildArticleSeoPerformanceRecommendations(snapshot, queries)
  };
}

function searchConsoleQueryOpportunity(query: { clicks: number; impressions: number; ctr: number; position: number | null }) {
  if ((query.position ?? 99) >= 4 && (query.position ?? 99) <= 20 && query.impressions >= 10) return "quick_win" as const;
  if (query.impressions >= 20 && query.ctr < 0.01) return "low_ctr" as const;
  return "observe" as const;
}

function buildArticleSeoPerformanceRecommendations(
  snapshot: ArticleReviewRow["seoPerformanceSnapshots"][number],
  queries: NonNullable<AdminArticleSeoPerformanceOverview>["queries"]
): string[] {
  const recommendations: string[] = [];
  const quickWins = queries.filter((query) => query.opportunity === "quick_win");
  const lowCtr = queries.filter((query) => query.opportunity === "low_ctr");
  if (quickWins.length > 0) {
    recommendations.push(`优先强化 ${quickWins[0]?.query}：它已经在 4-20 位附近，有机会通过标题、H2 和内链推到首页。`);
  }
  if (lowCtr.length > 0) {
    recommendations.push(`重写标题和 meta：${lowCtr[0]?.query} 有曝光但 CTR 偏低。`);
  }
  if (snapshot.impressions === 0) {
    recommendations.push("暂未获得曝光：先补内链、检查 canonical，并等待更多抓取数据。");
  }
  return recommendations;
}

function summarizeBrandVoice(
  campaignBrandVoice: { audience?: string | null; tone?: string | null; bannedWords?: string[] | null; examples?: string[] | null } | null | undefined,
  metadataBrandVoice: Record<string, unknown>,
  rawMetadata: Record<string, unknown>
) {
  const merged = {
    audience: stringValue(metadataBrandVoice.audience) ?? campaignBrandVoice?.audience ?? null,
    tone: stringValue(metadataBrandVoice.tone) ?? campaignBrandVoice?.tone ?? null,
    bannedWords: arrayValue(metadataBrandVoice.bannedWords).filter((value): value is string => typeof value === "string"),
    examples: arrayValue(metadataBrandVoice.examples).filter((value): value is string => typeof value === "string")
  };

  if (merged.bannedWords.length > 0 || merged.examples.length > 0 || merged.audience || merged.tone) {
    return merged;
  }

  const fallback = asRecord(rawMetadata.brandVoice);
  const fallbackWords = arrayValue(fallback.bannedWords).filter((value): value is string => typeof value === "string");
  const fallbackExamples = arrayValue(fallback.examples).filter((value): value is string => typeof value === "string");

  if (!fallbackWords.length && !fallbackExamples.length && !stringValue(fallback.audience) && !stringValue(fallback.tone)) {
    return null;
  }

  return {
    audience: stringValue(fallback.audience) ?? null,
    tone: stringValue(fallback.tone) ?? null,
    bannedWords: fallbackWords,
    examples: fallbackExamples
  };
}

function mapArticleRepairJob(article: ArticleReviewRow): QueuedJobSummary | null {
  const job = article.publishJobs.find((item) => {
    const payload = asRecord(item.payload);
    return payload.generationMode === "article_repair";
  });
  if (!job) return null;

  return mapQueuedJob(job, "AI article repair queued.");
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
      input: step.input,
      output: step.output,
      warnings: step.warnings,
      evidenceIds: step.evidenceIds,
      startedAt: toIso(step.startedAt),
      completedAt: toIso(step.completedAt),
      time: step.startedAt ? formatClock(step.startedAt, timezone) : null,
      latencyMs: step.latencyMs,
      metadata: step.metadata
    })),
    toolCalls: run.toolCalls.map((call) => {
      const callMetadata = asRecord(call.metadata);
      return {
      id: call.id,
      stage: call.stage,
      agentRole: call.agentRole,
      toolName: call.toolName,
      status: call.status,
      purpose: stringValue(callMetadata.purpose) ?? call.purpose,
      input: call.input,
      output: call.output,
      error: call.error,
      decisionSummary: stringValue(callMetadata.decisionSummary),
      evidenceIds: arrayValue(callMetadata.evidenceIds).filter((item): item is string => typeof item === "string"),
      warnings: call.warnings,
      startedAt: toIso(call.startedAt),
      completedAt: toIso(call.completedAt),
      latencyMs: call.latencyMs,
      metadata: call.metadata
      };
    }),
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
      query: evidence.query,
      publishedAt: evidence.publishedAt ? evidence.publishedAt.toISOString() : null,
      metric: evidence.metric,
      confidence: evidence.confidence,
      relevanceScore: evidence.relevanceScore,
      metadata: evidence.metadata,
      createdAt: evidence.createdAt.toISOString()
    }))
  };
}

function summarizeGenerationMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const provider = asRecord(record.provider);
  const ai = asRecord(record.ai);
  const brandVoice = asRecord(record.brandVoice);
  const contentEngine = asRecord(record.contentEngine);
  const finalQuality = asRecord(contentEngine.finalQuality);
  const finalSeo = asRecord(contentEngine.finalSeo);
  const artifacts = asRecord(contentEngine.artifacts);
  const keywords = asRecord(artifacts.keywords);
  const imageAsset = asRecord(record.imageAsset);
  const aiSearchReview = record.aiSearchReview ?? contentEngine.aiSearchReview ?? finalQuality.aiSearchReview ?? null;
  const seoAgent = record.seoAgent ?? artifacts.agentRun ?? null;
  const research = asRecord(seoAgent ? asRecord(seoAgent).research : null);
  const contentBrief = artifacts.contentBrief ?? (seoAgent ? asRecord(seoAgent).contentBrief : null) ?? null;
  const trendSignals = arrayValue(research.trendSignals);
  const entityInsights = arrayValue(record.entityInsights).length ? arrayValue(record.entityInsights) : arrayValue(research.entityInsights);
  const externalReferences = arrayValue(research.externalReferences);
  const marketInsights = arrayValue(research.marketInsights);
  const competitorAngles = arrayValue(research.competitorAngles);
  const sourceSummary = Object.keys(asRecord(research.sourceSummary)).length ? asRecord(research.sourceSummary) : null;

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
    brandVoice: Object.keys(brandVoice).length
      ? {
          audience: stringValue(brandVoice.audience),
          tone: stringValue(brandVoice.tone),
          bannedWords: arrayValue(brandVoice.bannedWords).filter((value): value is string => typeof value === "string"),
          examples: arrayValue(brandVoice.examples).filter((value): value is string => typeof value === "string")
        }
      : null,
    aiSearchReview,
    seoAgent,
    topicSelection: artifacts.topicSelection ?? null,
    topicSelectionV2: artifacts.topicSelectionV2 ?? null,
    research: Object.keys(research).length ? research : null,
    contentBrief,
    reflection: artifacts.reflection ?? null,
    keywordEvidence: artifacts.keywordEvidence ?? keywords.evidenceItems ?? keywords.evidence ?? null,
    trendSignals,
    entityInsights,
    externalReferences,
    marketInsights,
    competitorAngles,
    sourceSummary,
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

function mapSearchConsoleProperty(property: SearchConsolePropertyRow): AdminSearchConsolePropertyOverview {
  const publishedSiteUrl = publishedSiteUrlFromStore(property.store);

  return {
    id: property.id,
    storeId: property.store.id,
    store: property.store.name,
    publishedSiteUrl,
    siteUrl: property.siteUrl,
    status: property.status,
    statusTone: searchConsolePropertyTone(property.status),
    permissionLevel: property.permissionLevel,
    scopes: property.scopes,
    hasOAuthClient: Boolean(property.googleClientId),
    hasClientSecret: Boolean(property.googleClientSecretEncrypted),
    hasRefreshToken: Boolean(property.refreshTokenEncrypted),
    snapshotCount: property.snapshots.length,
    queryRowCount: property.queryRows.length,
    lastSyncedAt: toIso(property.lastSyncedAt),
    lastSyncError: property.lastSyncError,
    createdAt: property.createdAt.toISOString(),
    updatedAt: property.updatedAt.toISOString()
  };
}

function toUrlPrefixSiteUrl(host: string): string {
  const normalized = host.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  return normalized.endsWith("/") ? normalized : `https://${normalized}/`;
}

function publishedSiteUrlFromStore(store: { myshopifyDomain: string; metadata?: unknown }): string {
  const metadata = asRecord(store.metadata);
  const candidate = stringValue(metadata.primaryDomainUrl) ?? stringValue(metadata.shopUrl);
  const candidateHost =
    hostFromUrl(candidate) ??
    normalizePublishedHost(stringValue(metadata.primaryDomainHost)) ??
    undefined;

  if (candidateHost) {
    return `https://${candidateHost}`;
  }

  return `https://${store.myshopifyDomain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "")}`;
}

function normalizePublishedHost(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  return normalized || undefined;
}

function hostFromUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return normalizePublishedHost(new URL(value).hostname);
  } catch {
    return undefined;
  }
}

function mapSearchConsoleSnapshot(snapshot: SearchConsoleSnapshotRow): AdminSearchConsoleSnapshotOverview {
  return {
    id: snapshot.id,
    propertyId: snapshot.property.id,
    storeId: snapshot.store.id,
    store: snapshot.store.name,
    articleId: snapshot.article.id,
    article: snapshot.article.title ?? "Untitled article",
    siteUrl: snapshot.property.siteUrl,
    pageUrl: snapshot.pageUrl,
    startDate: snapshot.startDate.toISOString(),
    endDate: snapshot.endDate.toISOString(),
    dataState: snapshot.dataState,
    clicks: snapshot.clicks,
    impressions: snapshot.impressions,
    ctr: snapshot.ctr,
    position: snapshot.position,
    queryCount: snapshot.queryCount,
    topQuery: snapshot.topQuery,
    performanceScore: snapshot.performanceScore,
    syncedAt: snapshot.syncedAt.toISOString(),
    source: snapshot.source
  };
}

function buildPriorityBoardItems(input: {
  articles: PriorityArticleRow[];
  topicRuns: PriorityTopicRunRow[];
  memories: PriorityMemoryRow[];
  reflectionTasks: PriorityReflectionTaskRow[];
  steps: PriorityStepRow[];
  searchConsole: SearchConsoleSnapshotRow[];
  timezone: string;
  localeFallbacks: Map<string, string>;
  defaultLocale: string;
}): AdminPriorityBoardItem[] {
  const items: AdminPriorityBoardItem[] = [];

  for (const article of input.articles) {
    const snapshots = article.seoPerformanceSnapshots ?? [];
    const latestSnapshot = snapshots[0];
    const previousSnapshot = snapshots[1];
    const performanceScore = latestSnapshot?.performanceScore ?? null;
    const ctr = latestSnapshot?.ctr ?? null;
    const position = latestSnapshot?.position ?? null;
    const clicks = latestSnapshot?.clicks ?? null;
    const impressions = latestSnapshot?.impressions ?? null;
    const changePercent = previousSnapshot && latestSnapshot
      ? calcChangePercent(previousSnapshot.clicks + previousSnapshot.impressions, latestSnapshot.clicks + latestSnapshot.impressions)
      : null;

    if (article.status === "ready_to_publish" || article.status === "quality_failed" || article.status === "failed") {
      items.push(
        createPriorityItem({
          id: `article-${article.id}`,
          kind: article.status === "ready_to_publish" ? "quick_win" : article.status === "quality_failed" ? "low_ctr" : "declining",
          level: article.status === "ready_to_publish" ? "high" : "medium",
          score: clampScore((article.seoScore ?? 0) + (performanceScore ?? 0) / 2),
          title: article.title ?? "Untitled article",
          summary: article.status === "ready_to_publish"
            ? "文章已经达标，适合进入发布队列。"
            : article.status === "quality_failed"
              ? "文章在质检或 SEO 结果上仍有缺口，适合优先修正。"
              : "文章状态异常，需要尽快定位失败原因。",
          reason: article.failureReason ?? article.canonicalUrl ?? "Article workflow needs attention.",
          actionLabel: "AI 修复",
          actionType: "repair_article",
          actionHref: `/articles/${article.id}`,
          repairReason: articleRepairReason(article, latestSnapshot),
          articleId: article.id,
          campaignId: article.campaign?.id ?? null,
          topicRunId: article.seoTopicRuns[0]?.id ?? null,
          storeId: article.store.id,
          store: article.store.name,
          article: article.title ?? "Untitled article",
          campaign: article.campaign?.title ?? null,
          locale: article.locale,
          campaignDraft: null,
          evidence: [
            article.primaryKeyword ? `Primary keyword: ${article.primaryKeyword}` : null,
            latestSnapshot?.topQuery ? `Top query: ${latestSnapshot.topQuery}` : null,
            latestSnapshot?.property.siteUrl ? `Property: ${latestSnapshot.property.siteUrl}` : null
          ].filter((value): value is string => Boolean(value)),
          metrics: {
            clicks,
            impressions,
            ctr,
            position,
            performanceScore,
            changePercent,
            opportunityScore: null,
            memoryRisk: null,
            potentialClicks: estimatePotentialClicks(latestSnapshot?.impressions, latestSnapshot?.ctr, position)
          },
          updatedAt: article.updatedAt.toISOString()
        })
      );
    }
  }

  for (const snapshot of input.searchConsole) {
    const article = snapshot.article;
    const score = snapshot.performanceScore ?? scoreSearchConsoleSnapshot(snapshot);
    const expectedCtr = expectedCtrForPosition(snapshot.position);
    const missedClicks = snapshot.impressions > 0 && snapshot.ctr < expectedCtr
      ? Math.max(0, Math.round(snapshot.impressions * expectedCtr) - Math.round(snapshot.clicks))
      : 0;

    if (snapshot.position !== null && snapshot.position >= 11 && snapshot.position <= 20) {
      items.push(
        createPriorityItem({
          id: `quick-win-${snapshot.id}`,
          kind: "quick_win",
          level: snapshot.position <= 15 ? "critical" : "high",
          score: clampScore(100 - snapshot.position * 2 + Math.min(25, Math.log10(snapshot.impressions + 1) * 8) + Math.min(20, snapshot.queryCount * 2)),
          title: article.title ?? "Untitled article",
          summary: `关键词接近第一页，适合做快赢优化。`,
          reason: snapshot.topQuery ? `Top query: ${snapshot.topQuery}` : `Page position ${snapshot.position}.`,
          actionLabel: "同步文章搜索表现",
          actionType: "sync_search_console",
          actionHref: `/articles/${snapshot.articleId}`,
          articleId: snapshot.articleId,
          campaignId: null,
          topicRunId: null,
          storeId: snapshot.storeId,
          store: snapshot.store.name,
          article: article.title ?? "Untitled article",
          campaign: null,
          locale: null,
          campaignDraft: null,
          evidence: [
            `Position ${snapshot.position.toFixed(1)}`,
            `CTR ${(snapshot.ctr * 100).toFixed(1)}%`,
            snapshot.topQuery ? `Top query: ${snapshot.topQuery}` : "No top query"
          ],
          metrics: {
            clicks: snapshot.clicks,
            impressions: snapshot.impressions,
            ctr: snapshot.ctr,
            position: snapshot.position,
            performanceScore: score,
            changePercent: null,
            opportunityScore: clampScore(100 - snapshot.position * 2 + Math.min(25, Math.log10(snapshot.impressions + 1) * 8) + Math.min(20, snapshot.queryCount * 2)),
            memoryRisk: null,
            potentialClicks: missedClicks
          },
          updatedAt: snapshot.syncedAt.toISOString()
        })
      );
    } else if (snapshot.position !== null && snapshot.position <= 10 && snapshot.ctr < expectedCtr * 0.6 && snapshot.impressions >= 100) {
      items.push(
        createPriorityItem({
          id: `low-ctr-${snapshot.id}`,
          kind: "low_ctr",
          level: missedClicks > 50 ? "critical" : "high",
          score: clampScore(Math.min(100, missedClicks / 3 + score / 2)),
          title: article.title ?? "Untitled article",
          summary: "高曝光但 CTR 偏低，适合优化标题、摘要和首段。",
          reason: `CTR ${(snapshot.ctr * 100).toFixed(1)}% is below expectation.`,
          actionLabel: "打开文章审核",
          actionType: "review_article",
          actionHref: `/articles/${snapshot.articleId}`,
          articleId: snapshot.articleId,
          campaignId: null,
          topicRunId: null,
          storeId: snapshot.storeId,
          store: snapshot.store.name,
          article: article.title ?? "Untitled article",
          campaign: null,
          locale: null,
          campaignDraft: null,
          evidence: [`Impressions ${snapshot.impressions}`, `Expected CTR ${(expectedCtr * 100).toFixed(1)}%`, `Current CTR ${(snapshot.ctr * 100).toFixed(1)}%`],
          metrics: {
            clicks: snapshot.clicks,
            impressions: snapshot.impressions,
            ctr: snapshot.ctr,
            position: snapshot.position,
            performanceScore: score,
            changePercent: null,
            opportunityScore: null,
            memoryRisk: null,
            potentialClicks: missedClicks
          },
          updatedAt: snapshot.syncedAt.toISOString()
        })
      );
    }
  }

  for (const run of input.topicRuns) {
    const selected = run.selectedCandidate;
    if (!selected) continue;
    const opportunity = selected.opportunityScore ?? selected.score ?? run.article?.seoScore ?? 0;
    const memoryRisk = deriveRunMemoryRisk(run, input.memories);
    const reflectionCount = run.reflectionTasks.length;
    const stepWarnings = run.steps.reduce((count, step) => count + (step.warnings?.length ?? 0) + (step.status === "failed" ? 1 : 0), 0);
    const topic = run.selectedTopic ?? selected.topic;
    const primaryKeyword = selected.primaryKeyword ?? topic ?? run.article?.primaryKeyword ?? null;
    const locale = run.locale ?? resolveLocaleForStore(run.store.id, input.localeFallbacks, input.defaultLocale);
    const campaignHref = buildCampaignActionHref({
      storeId: run.store.id,
      locale,
      topic,
      primaryKeyword,
      keywords: uniqueStrings([primaryKeyword ?? "", topic ?? "", run.article?.primaryKeyword ?? ""]),
      targetWordCount: 1600
    });
    items.push(
      createPriorityItem({
        id: `run-${run.id}`,
        kind: "topic_opportunity",
        level: opportunity >= 80 ? "critical" : opportunity >= 65 ? "high" : "medium",
        score: clampScore(opportunity + Math.min(10, run.evidenceItems.length * 2) - Math.min(15, memoryRisk)),
        title: topic ?? "Topic opportunity",
        summary: `主题运行已经给出明确机会分数，适合转成新的内容任务。`,
        reason: run.objective ?? selected.rejectedReason ?? "Topic run is ready for action.",
        actionLabel: campaignHref ? "创建内容任务" : run.article?.id ? "AI 修复" : "查看运行",
        actionType: campaignHref ? "new_campaign" : run.article?.id ? "repair_article" : "view_run",
        actionHref: campaignHref ?? (run.article?.id ? `/articles/${run.article.id}` : "/campaigns"),
        repairReason: run.article?.id ? topicRunRepairReason(run, selected, opportunity, memoryRisk, reflectionCount, stepWarnings) : null,
        articleId: run.article?.id ?? null,
        campaignId: run.campaign?.id ?? null,
        topicRunId: run.id,
        storeId: run.store.id,
        store: run.store.name,
        article: run.article?.title ?? null,
        campaign: run.campaign?.title ?? null,
        locale,
        campaignDraft: campaignHref
          ? {
              storeId: run.store.id,
              locale,
              sourceType: "manual_topic",
              sourceId: run.article?.id ?? run.campaign?.id ?? null,
              topic,
              primaryKeyword,
              keywords: uniqueStrings([primaryKeyword ?? "", topic ?? "", run.article?.primaryKeyword ?? ""]),
              publishPolicy: "manual_review",
              targetWordCount: 1600
            }
          : null,
        evidence: [
          `Opportunity ${opportunity.toFixed(1)}`,
          `Reflection tasks ${reflectionCount}`,
          `Warnings ${stepWarnings}`
        ],
        metrics: {
          clicks: run.article?.seoScore ?? null,
          impressions: null,
          ctr: null,
          position: null,
          performanceScore: run.article?.seoScore ?? null,
          changePercent: null,
          opportunityScore: opportunity,
          memoryRisk,
          potentialClicks: null
        },
        updatedAt: run.updatedAt.toISOString()
      })
    );
  }

  for (const task of input.reflectionTasks) {
    const priority = task.priority?.toUpperCase?.() === "P0" ? "critical" : task.priority?.toUpperCase?.() === "P1" ? "high" : "medium";
    items.push(
      createPriorityItem({
        id: `reflection-${task.id}`,
        kind: "reflection_task",
        level: priority,
        score: priority === "critical" ? 95 : priority === "high" ? 82 : 68,
        title: task.instruction,
        summary: task.acceptanceCheck ?? "反思任务等待处理。",
        reason: task.status,
        actionLabel: task.article?.id ? "AI 修复" : "查看任务",
        actionType: task.article?.id ? "repair_article" : "view_run",
        actionHref: task.article?.id ? `/articles/${task.article.id}` : "/campaigns",
        repairReason: task.article?.id ? taskRepairReason(task) : null,
        articleId: task.article?.id ?? null,
        campaignId: task.campaign?.id ?? null,
        topicRunId: task.topicRun?.id ?? null,
        storeId: task.store.id,
        store: task.store.name,
        article: task.article?.title ?? null,
        campaign: task.campaign?.title ?? null,
        locale: task.article ? null : null,
        campaignDraft: null,
        evidence: task.evidenceIds.length ? task.evidenceIds : [task.status],
        metrics: {
          clicks: null,
          impressions: null,
          ctr: null,
          position: null,
          performanceScore: null,
          changePercent: null,
          opportunityScore: null,
          memoryRisk: null,
          potentialClicks: null
        },
        updatedAt: task.resolvedAt?.toISOString() ?? task.createdAt.toISOString()
      })
    );
  }

  for (const step of input.steps) {
    if (step.status !== "failed" && step.warnings.length === 0) continue;
    items.push(
      createPriorityItem({
        id: `step-${step.id}`,
        kind: "agent_step",
        level: step.status === "failed" ? "high" : "medium",
        score: step.status === "failed" ? 80 : 58,
        title: step.title,
        summary: step.summary ?? "Agent step needs attention.",
        reason: step.decision ?? step.error ?? "Step emitted warnings.",
        actionLabel: step.article?.id ? "AI 修复" : "查看运行",
        actionType: step.article?.id ? "repair_article" : "view_run",
        actionHref: step.article?.id ? `/articles/${step.article.id}` : "/campaigns",
        repairReason: step.article?.id ? stepRepairReason(step) : null,
        articleId: step.article?.id ?? null,
        campaignId: step.campaign?.id ?? null,
        topicRunId: step.topicRun?.id ?? null,
        storeId: step.store.id,
        store: step.store.name,
        article: step.article?.title ?? null,
        campaign: step.campaign?.title ?? null,
        locale: null,
        campaignDraft: null,
        evidence: step.warnings.length ? step.warnings : step.evidenceIds,
        metrics: {
          clicks: null,
          impressions: null,
          ctr: null,
          position: null,
          performanceScore: null,
          changePercent: null,
          opportunityScore: null,
          memoryRisk: null,
          potentialClicks: null
        },
        updatedAt: step.completedAt?.toISOString() ?? step.createdAt.toISOString()
      })
    );
  }

  for (const memory of input.memories) {
    const risk = memoryRiskScore(memory);
    if (risk < 60) continue;
    items.push(
      createPriorityItem({
        id: `memory-${memory.id}`,
        kind: "memory_risk",
        level: risk >= 80 ? "critical" : "high",
        score: risk,
        title: memory.keyword ?? memory.topicFingerprint ?? "Agent memory risk",
        summary: memory.learnedRule ?? "Long-term agent memory needs to be respected.",
        reason: memory.outcome,
        actionLabel: memory.article?.id ? "AI 修复" : "查看记忆",
        actionType: memory.article?.id ? "repair_article" : "view_run",
        actionHref: memory.article?.id ? `/articles/${memory.article.id}` : "/campaigns",
        repairReason: memory.article?.id ? memoryRepairReason(memory) : null,
        articleId: memory.article?.id ?? null,
        campaignId: memory.campaign?.id ?? null,
        topicRunId: null,
        storeId: memory.store.id,
        store: memory.store.name,
        article: memory.article?.title ?? null,
        campaign: memory.campaign?.title ?? null,
        locale: memory.locale,
        campaignDraft: null,
        evidence: [
          memory.angleKey ? `Angle ${memory.angleKey}` : null,
          memory.avoidUntil ? `Avoid until ${memory.avoidUntil.toISOString().slice(0, 10)}` : null
        ].filter((value): value is string => Boolean(value)),
        metrics: {
          clicks: null,
          impressions: null,
          ctr: null,
          position: null,
          performanceScore: memory.qualityScore ?? null,
          changePercent: null,
          opportunityScore: null,
          memoryRisk: risk,
          potentialClicks: null
        },
        updatedAt: memory.updatedAt.toISOString()
      })
    );
  }

  return items.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  }).slice(0, 40);
}

function buildPerformanceReviewItems(input: {
  snapshots: PerformanceReviewSnapshotRow[];
  queryRows: PerformanceReviewQueryRow[];
  memories: PriorityMemoryRow[];
  steps: PriorityStepRow[];
  topicRuns: PriorityTopicRunRow[];
  timezone: string;
  localeFallbacks: Map<string, string>;
  defaultLocale: string;
}): AdminPerformanceReviewItem[] {
  const items: AdminPerformanceReviewItem[] = [];
  const groupedSnapshots = groupSnapshotsByArticleId(input.snapshots);
  const groupedQueryRows = groupByArticleId(input.queryRows);

  for (const snapshot of input.snapshots) {
    const article = snapshot.article;
    const previous = groupedSnapshots.get(snapshot.articleId)?.[1] ?? null;
    const trendPercent = previous ? calcChangePercent(previous.clicks + previous.impressions, snapshot.clicks + snapshot.impressions) : null;
    const queryRows = groupedQueryRows.get(snapshot.articleId) ?? [];
    const queryCount = queryRows.length;
    const expectedCtr = expectedCtrForPosition(snapshot.position);
    const missedClicks = snapshot.impressions > 0 && snapshot.ctr < expectedCtr
      ? Math.max(0, Math.round(snapshot.impressions * expectedCtr) - Math.round(snapshot.clicks))
      : 0;
    const trafficLoss = previous ? Math.max(0, Math.round(previous.clicks + previous.impressions - (snapshot.clicks + snapshot.impressions))) : null;
    const topQuery = snapshot.topQuery ?? queryRows[0]?.query ?? article.primaryKeyword ?? "unknown query";
    const snapshotRepairReason = performanceRepairReason({
      kind: "quick_win",
      title: article.title ?? "Untitled article",
      topQuery,
      position: snapshot.position,
      ctr: snapshot.ctr,
      expectedCtr,
      missedClicks,
      trendPercent,
      trafficLoss,
      queryCount,
      clicks: snapshot.clicks,
      impressions: snapshot.impressions
    });

    if (snapshot.position !== null && snapshot.position >= 11 && snapshot.position <= 20) {
      items.push(
        createPerformanceReviewItem({
          id: `review-quick-win-${snapshot.id}`,
          kind: "quick_win",
          level: snapshot.position <= 15 ? "high" : "medium",
          score: clampScore(92 - snapshot.position * 2 + Math.min(20, Math.log10(snapshot.impressions + 1) * 5)),
          title: article.title ?? "Untitled article",
          summary: "关键词已经在页二附近，最适合做快赢优化。",
          reason: snapshot.topQuery ? `Top query: ${snapshot.topQuery}` : `Position ${snapshot.position}.`,
          actionLabel: "AI 修复快赢",
          actionType: "repair_article",
          actionHref: `/articles/${snapshot.articleId}`,
          repairReason: snapshotRepairReason,
          articleId: snapshot.articleId,
          storeId: snapshot.storeId,
          store: snapshot.store.name,
          article: article.title ?? "Untitled article",
          locale: null,
          evidence: [
            `Position ${snapshot.position.toFixed(1)}`,
            `CTR ${(snapshot.ctr * 100).toFixed(1)}%`,
            `Queries ${queryCount}`
          ],
          metrics: {
            clicks: snapshot.clicks,
            impressions: snapshot.impressions,
            ctr: snapshot.ctr,
            position: snapshot.position,
            performanceScore: snapshot.performanceScore ?? null,
            changePercent: trendPercent,
            opportunityScore: clampScore(100 - snapshot.position * 2),
            memoryRisk: deriveArticleMemoryRisk(snapshot.articleId, input.memories),
            potentialClicks: missedClicks,
            trendPercent,
            trafficLoss,
            queryCount
          },
          updatedAt: snapshot.syncedAt.toISOString()
        })
      );
    }

    if (snapshot.position !== null && snapshot.position <= 10 && snapshot.ctr < expectedCtr * 0.7 && snapshot.impressions >= 120) {
      items.push(
        createPerformanceReviewItem({
          id: `review-low-ctr-${snapshot.id}`,
          kind: "low_ctr",
          level: missedClicks > 50 ? "high" : "medium",
          score: clampScore(Math.min(100, missedClicks / 2 + (snapshot.performanceScore ?? 0) / 2)),
          title: article.title ?? "Untitled article",
          summary: "高曝光但点击率偏低，适合调标题、摘要和首屏结构。",
          reason: `CTR ${(snapshot.ctr * 100).toFixed(1)}% is below expectation.`,
          actionLabel: "AI 优化 CTR",
          actionType: "repair_article",
          actionHref: `/articles/${snapshot.articleId}`,
          repairReason: performanceRepairReason({
            kind: "low_ctr",
            title: article.title ?? "Untitled article",
            topQuery,
            position: snapshot.position,
            ctr: snapshot.ctr,
            expectedCtr,
            missedClicks,
            trendPercent,
            trafficLoss,
            queryCount,
            clicks: snapshot.clicks,
            impressions: snapshot.impressions
          }),
          articleId: snapshot.articleId,
          storeId: snapshot.storeId,
          store: snapshot.store.name,
          article: article.title ?? "Untitled article",
          locale: null,
          evidence: [
            `Impressions ${snapshot.impressions}`,
            `Expected CTR ${(expectedCtr * 100).toFixed(1)}%`,
            `Queries ${queryCount}`
          ],
          metrics: {
            clicks: snapshot.clicks,
            impressions: snapshot.impressions,
            ctr: snapshot.ctr,
            position: snapshot.position,
            performanceScore: snapshot.performanceScore ?? null,
            changePercent: trendPercent,
            opportunityScore: null,
            memoryRisk: deriveArticleMemoryRisk(snapshot.articleId, input.memories),
            potentialClicks: missedClicks,
            trendPercent,
            trafficLoss,
            queryCount
          },
          updatedAt: snapshot.syncedAt.toISOString()
        })
      );
    }

    if (trendPercent !== null && trendPercent < -12) {
      items.push(
        createPerformanceReviewItem({
          id: `review-declining-${snapshot.id}`,
          kind: "declining",
          level: trendPercent < -30 ? "high" : "medium",
          score: clampScore(Math.abs(trendPercent) + Math.min(30, snapshot.impressions / 20)),
          title: article.title ?? "Untitled article",
          summary: "最近表现明显下滑，适合做内容刷新或结构重写。",
          reason: `Performance change ${trendPercent.toFixed(1)}%.`,
          actionLabel: "AI 刷新内容",
          actionType: "repair_article",
          actionHref: `/articles/${snapshot.articleId}`,
          repairReason: performanceRepairReason({
            kind: "declining",
            title: article.title ?? "Untitled article",
            topQuery,
            position: snapshot.position,
            ctr: snapshot.ctr,
            expectedCtr,
            missedClicks,
            trendPercent,
            trafficLoss,
            queryCount,
            clicks: snapshot.clicks,
            impressions: snapshot.impressions
          }),
          articleId: snapshot.articleId,
          storeId: snapshot.storeId,
          store: snapshot.store.name,
          article: article.title ?? "Untitled article",
          locale: null,
          evidence: [
            `Trend ${trendPercent.toFixed(1)}%`,
            `Clicks ${snapshot.clicks}`,
            `Impressions ${snapshot.impressions}`
          ],
          metrics: {
            clicks: snapshot.clicks,
            impressions: snapshot.impressions,
            ctr: snapshot.ctr,
            position: snapshot.position,
            performanceScore: snapshot.performanceScore ?? null,
            changePercent: trendPercent,
            opportunityScore: null,
            memoryRisk: deriveArticleMemoryRisk(snapshot.articleId, input.memories),
            potentialClicks: null,
            trendPercent,
            trafficLoss,
            queryCount
          },
          updatedAt: snapshot.syncedAt.toISOString()
        })
      );
    }
  }

  for (const queryRow of input.queryRows) {
    if (queryRow.position === null || queryRow.position > 20 || queryRow.position < 11) continue;
    items.push(
      createPerformanceReviewItem({
        id: `review-query-${queryRow.id}`,
        kind: "topic_opportunity",
        level: queryRow.position <= 15 ? "high" : "medium",
        score: clampScore(100 - queryRow.position * 2 + Math.min(20, Math.log10(queryRow.impressions + 1) * 4)),
        title: queryRow.article.title ?? "Untitled article",
        summary: `Query "${queryRow.query}" has page-two potential.`,
        reason: `Query position ${queryRow.position.toFixed(1)}.`,
        actionLabel: "AI 修复快赢",
        actionType: "repair_article",
        actionHref: `/articles/${queryRow.articleId}`,
        repairReason: performanceRepairReason({
          kind: "quick_win",
          title: queryRow.article.title ?? "Untitled article",
          topQuery: queryRow.query,
          position: queryRow.position,
          ctr: queryRow.ctr,
          expectedCtr: expectedCtrForPosition(queryRow.position),
          missedClicks: Math.max(0, Math.round(queryRow.impressions * expectedCtrForPosition(queryRow.position)) - Math.round(queryRow.clicks)),
          trendPercent: null,
          trafficLoss: null,
          queryCount: 1,
          clicks: queryRow.clicks,
          impressions: queryRow.impressions
        }),
        articleId: queryRow.articleId,
        storeId: queryRow.storeId,
        store: queryRow.store.name,
        article: queryRow.article.title ?? "Untitled article",
        locale: resolveLocaleForStore(queryRow.storeId, input.localeFallbacks, input.defaultLocale),
        evidence: [
          `Query ${queryRow.query}`,
          `Position ${queryRow.position?.toFixed(1) ?? "-"}`,
          `Clicks ${queryRow.clicks}`
        ],
        metrics: {
          clicks: queryRow.clicks,
          impressions: queryRow.impressions,
          ctr: queryRow.ctr,
          position: queryRow.position,
          performanceScore: queryRow.snapshot?.performanceScore ?? null,
          changePercent: null,
          opportunityScore: clampScore(100 - queryRow.position * 2 + Math.min(20, Math.log10(queryRow.impressions + 1) * 4)),
          memoryRisk: deriveArticleMemoryRisk(queryRow.articleId, input.memories),
          potentialClicks: estimatePotentialClicks(queryRow.impressions, queryRow.ctr, queryRow.position),
          trendPercent: null,
          trafficLoss: null,
          queryCount: null
        },
        updatedAt: queryRow.syncedAt.toISOString()
      })
    );
  }

  for (const [articleId, rows] of groupedQueryRows.entries()) {
    if (rows.length < 2) continue;
    const latest = rows[0];
    const previous = rows[1];
    const growthPercent = calcGrowthPercent(previous.impressions, latest.impressions);
    if (growthPercent === null || growthPercent < 30) continue;
    const topic = latest.query ?? latest.article.primaryKeyword ?? latest.article.title ?? null;
    const primaryKeyword = latest.article.primaryKeyword ?? latest.query ?? null;
    const locale = resolveLocaleForStore(latest.storeId, input.localeFallbacks, input.defaultLocale);
    const campaignHref = buildCampaignActionHref({
      storeId: latest.storeId,
      locale,
      topic,
      primaryKeyword,
      keywords: uniqueStrings([latest.query, latest.article.primaryKeyword ?? "", latest.article.title ?? ""]),
      targetWordCount: 1800
    });

    items.push(
      createPerformanceReviewItem({
        id: `review-trend-${articleId}-${latest.id}`,
        kind: "trend",
        level: growthPercent >= 100 ? "high" : "medium",
        score: clampScore(60 + Math.min(30, growthPercent / 2) + Math.min(15, Math.log10(latest.impressions + 1) * 4)),
        title: topic ?? latest.article.title ?? "Untitled article",
        summary: "最近 query 层需求在上升，适合趁热立项新内容。",
        reason: `Query demand +${growthPercent.toFixed(1)}%`,
        actionLabel: campaignHref ? "创建内容任务" : "打开文章审核",
        actionType: campaignHref ? "new_campaign" : "review_article",
        actionHref: campaignHref ?? `/articles/${articleId}`,
        articleId,
        storeId: latest.storeId,
        store: latest.store.name,
        article: latest.article.title ?? "Untitled article",
        locale,
        campaignDraft: campaignHref
          ? {
              storeId: latest.storeId,
              locale,
              sourceType: "manual_topic",
              sourceId: latest.articleId,
              topic,
              primaryKeyword,
              keywords: uniqueStrings([latest.query, latest.article.primaryKeyword ?? "", latest.article.title ?? ""]),
              publishPolicy: "manual_review",
              targetWordCount: 1800
            }
          : null,
        evidence: [
          `Growth ${growthPercent.toFixed(1)}%`,
          `Latest query ${latest.query}`,
          `Previous clicks ${previous.clicks.toFixed(1)} → ${latest.clicks.toFixed(1)}`
        ],
        metrics: {
          clicks: latest.clicks,
          impressions: latest.impressions,
          ctr: latest.ctr,
          position: latest.position,
          performanceScore: latest.snapshot?.performanceScore ?? null,
          changePercent: growthPercent,
          opportunityScore: clampScore(60 + Math.min(30, growthPercent / 2)),
          memoryRisk: deriveArticleMemoryRisk(articleId, input.memories),
          potentialClicks: estimatePotentialClicks(latest.impressions, latest.ctr, latest.position),
          trendPercent: growthPercent,
          trafficLoss: null,
          queryCount: rows.length
        },
        updatedAt: latest.syncedAt.toISOString()
      })
    );
  }

  for (const run of input.topicRuns) {
    const selected = run.selectedCandidate;
    if (!selected) continue;
    const opportunity = selected.opportunityScore ?? selected.score ?? run.article?.seoScore ?? 0;
    const memoryRisk = deriveRunMemoryRisk(run, input.memories);
    const stepWarnings = run.steps.reduce((count, step) => count + (step.warnings?.length ?? 0) + (step.status === "failed" ? 1 : 0), 0);
    items.push(
      createPerformanceReviewItem({
        id: `review-run-${run.id}`,
        kind: "topic_opportunity",
        level: opportunity >= 80 ? "high" : "medium",
        score: clampScore(opportunity + Math.min(10, run.evidenceItems.length * 2) - Math.min(15, memoryRisk)),
        title: run.selectedTopic ?? selected.topic,
        summary: "主题运行给出了新的机会信号，适合转成下一篇内容或更新现有文章。",
        reason: run.objective ?? selected.rejectedReason ?? "Topic run is ready for action.",
        actionLabel: run.article?.id ? "AI 修复" : "查看运行",
        actionType: run.article?.id ? "repair_article" : "view_run",
        actionHref: run.article?.id ? `/articles/${run.article.id}` : "/campaigns",
        repairReason: run.article?.id ? topicRunRepairReason(run, selected, opportunity, memoryRisk, 0, stepWarnings) : null,
        articleId: run.article?.id ?? null,
        storeId: run.store.id,
        store: run.store.name,
        article: run.article?.title ?? null,
        locale: run.locale,
        evidence: [`Opportunity ${opportunity.toFixed(1)}`, `Warnings ${stepWarnings}`],
        metrics: {
          clicks: run.article?.seoScore ?? null,
          impressions: null,
          ctr: null,
          position: null,
          performanceScore: run.article?.seoScore ?? null,
          changePercent: null,
          opportunityScore: opportunity,
          memoryRisk,
          potentialClicks: null,
          trendPercent: null,
          trafficLoss: null,
          queryCount: null
        },
        updatedAt: run.updatedAt.toISOString()
      })
    );
  }

  for (const memory of input.memories) {
    const risk = memoryRiskScore(memory);
    if (risk < 60) continue;
    items.push(
      createPerformanceReviewItem({
        id: `review-memory-${memory.id}`,
        kind: "memory_risk",
        level: risk >= 80 ? "high" : "medium",
        score: risk,
        title: memory.keyword ?? memory.topicFingerprint ?? "Agent memory risk",
        summary: memory.learnedRule ?? "Long-term agent memory needs to be respected.",
        reason: memory.outcome,
        actionLabel: memory.article?.id ? "打开文章审核" : "查看记忆",
        actionType: memory.article?.id ? "review_article" : "view_run",
        actionHref: memory.article?.id ? `/articles/${memory.article.id}` : "/campaigns",
        articleId: memory.article?.id ?? null,
        storeId: memory.store.id,
        store: memory.store.name,
        article: memory.article?.title ?? null,
        locale: memory.locale,
        evidence: [
          memory.angleKey ? `Angle ${memory.angleKey}` : null,
          memory.avoidUntil ? `Avoid until ${memory.avoidUntil.toISOString().slice(0, 10)}` : null
        ].filter((value): value is string => Boolean(value)),
        metrics: {
          clicks: null,
          impressions: null,
          ctr: null,
          position: null,
          performanceScore: memory.qualityScore ?? null,
          changePercent: null,
          opportunityScore: null,
          memoryRisk: risk,
          potentialClicks: null,
          trendPercent: null,
          trafficLoss: null,
          queryCount: null
        },
        updatedAt: memory.updatedAt.toISOString()
      })
    );
  }

  for (const step of input.steps) {
    if (step.status !== "failed" && step.warnings.length === 0) continue;
    items.push(
      createPerformanceReviewItem({
        id: `review-step-${step.id}`,
        kind: "agent_step",
        level: step.status === "failed" ? "high" : "medium",
        score: step.status === "failed" ? 80 : 58,
        title: step.title,
        summary: step.summary ?? "Agent step needs attention.",
        reason: step.decision ?? step.error ?? "Step emitted warnings.",
        actionLabel: step.article?.id ? "打开文章审核" : "查看运行",
        actionType: step.article?.id ? "review_article" : "view_run",
        actionHref: step.article?.id ? `/articles/${step.article.id}` : "/campaigns",
        articleId: step.article?.id ?? null,
        storeId: step.store.id,
        store: step.store.name,
        article: step.article?.title ?? null,
        locale: null,
        evidence: step.warnings.length ? step.warnings : step.evidenceIds,
        metrics: {
          clicks: null,
          impressions: null,
          ctr: null,
          position: null,
          performanceScore: null,
          changePercent: null,
          opportunityScore: null,
          memoryRisk: null,
          potentialClicks: null,
          trendPercent: null,
          trafficLoss: null,
          queryCount: null
        },
        updatedAt: step.completedAt?.toISOString() ?? step.createdAt.toISOString()
      })
    );
  }

  return items
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })
    .slice(0, 60);
}

function summarizePerformanceReview(items: AdminPerformanceReviewItem[]): AdminPerformanceReviewSummary {
  let quickWins = 0;
  let declining = 0;
  let lowCtr = 0;
  let topicOpportunities = 0;
  let trends = 0;
  let memoryRisks = 0;
  let stepWarnings = 0;
  let totalPotentialClicks = 0;

  for (const item of items) {
    if (item.kind === "quick_win") quickWins += 1;
    if (item.kind === "declining") declining += 1;
    if (item.kind === "low_ctr") lowCtr += 1;
    if (item.kind === "topic_opportunity") topicOpportunities += 1;
    if (item.kind === "trend") trends += 1;
    if (item.kind === "memory_risk") memoryRisks += 1;
    if (item.kind === "agent_step") stepWarnings += 1;
    totalPotentialClicks += item.metrics.potentialClicks ?? 0;
  }

  return {
    quickWins,
    declining,
    lowCtr,
    topicOpportunities,
    trends,
    memoryRisks,
    stepWarnings,
    totalPotentialClicks
  };
}

function summarizePriorityBoard(items: AdminPriorityBoardItem[]): AdminPriorityBoardSummary {
  let quickWins = 0;
  let declining = 0;
  let lowCtr = 0;
  let topicOpportunities = 0;
  let reflectionTasks = 0;
  let stepWarnings = 0;
  let memoryRisks = 0;
  let potentialClickGain = 0;

  for (const item of items) {
    if (item.kind === "quick_win") quickWins += 1;
    if (item.kind === "declining") declining += 1;
    if (item.kind === "low_ctr") lowCtr += 1;
    if (item.kind === "topic_opportunity") topicOpportunities += 1;
    if (item.kind === "reflection_task") reflectionTasks += 1;
    if (item.kind === "agent_step") stepWarnings += 1;
    if (item.kind === "memory_risk") memoryRisks += 1;
    potentialClickGain += item.metrics.potentialClicks ?? 0;
  }

  return {
    quickWins,
    declining,
    lowCtr,
    topicOpportunities,
    reflectionTasks,
    stepWarnings,
    memoryRisks,
    potentialClickGain
  };
}

function createPriorityItem(input: {
  id: string;
  kind: AdminPriorityKind;
  level: AdminPriorityLevel;
  score: number;
  title: string;
  summary: string;
  reason: string;
  actionLabel: string;
  actionType: AdminPriorityBoardItem["actionType"];
  actionHref: string | null;
  repairReason?: string | null;
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
  metrics: AdminPriorityBoardItem["metrics"];
  updatedAt: string;
}): AdminPriorityBoardItem {
  return {
    ...input,
    repairReason: input.repairReason ?? null,
    campaignDraft: input.campaignDraft ?? null,
    score: clampScore(input.score),
    evidence: uniqueStrings(input.evidence),
    metrics: {
      ...input.metrics,
      changePercent: normalizeMaybeNumber(input.metrics.changePercent),
      ctr: normalizeMaybeNumber(input.metrics.ctr),
      clicks: normalizeMaybeNumber(input.metrics.clicks),
      impressions: normalizeMaybeNumber(input.metrics.impressions),
      memoryRisk: normalizeMaybeNumber(input.metrics.memoryRisk),
      opportunityScore: normalizeMaybeNumber(input.metrics.opportunityScore),
      position: normalizeMaybeNumber(input.metrics.position),
      potentialClicks: normalizeMaybeNumber(input.metrics.potentialClicks),
      performanceScore: normalizeMaybeNumber(input.metrics.performanceScore)
    }
  };
}

function articleRepairReason(
  article: { primaryKeyword?: string | null; status: string },
  latestSnapshot?: { topQuery?: string | null } | null
) {
  const topQuery = latestSnapshot?.topQuery ?? article.primaryKeyword ?? "unknown query";
  return `SEO Machine workflow: analyze-existing -> rewrite -> optimize -> performance-review. Refine this article around top query "${topQuery}" and current article state ${article.status}.`;
}

function topicRunRepairReason(
  run: PriorityTopicRunRow,
  selected: NonNullable<PriorityTopicRunRow["selectedCandidate"]>,
  opportunity: number,
  memoryRisk: number,
  reflectionCount: number,
  stepWarnings: number
) {
  return `SEO Machine workflow: analyze-existing -> rewrite -> optimize -> performance-review. Topic ${run.selectedTopic ?? selected.topic} has opportunity ${opportunity.toFixed(1)} and memory risk ${memoryRisk}. Reflection tasks ${reflectionCount}, step warnings ${stepWarnings}.`;
}

function taskRepairReason(task: PriorityReflectionTaskRow) {
  return `SEO Machine workflow: analyze-existing -> rewrite -> optimize -> performance-review. Follow reflection task "${task.instruction}" and confirm evidence: ${task.acceptanceCheck ?? "visible in article"}.`;
}

function stepRepairReason(step: PriorityStepRow) {
  return `SEO Machine workflow: analyze-existing -> rewrite -> optimize -> performance-review. Fix step "${step.title}" after warning/failure: ${step.decision ?? step.error ?? "needs attention"}.`;
}

function memoryRepairReason(memory: PriorityMemoryRow) {
  return `SEO Machine workflow: analyze-existing -> rewrite -> optimize -> performance-review. Respect memory guidance for ${memory.keyword ?? memory.topicFingerprint ?? "this topic"} because the last outcome was ${memory.outcome}.`;
}

function createPerformanceReviewItem(input: {
  id: string;
  kind: AdminPerformanceReviewItem["kind"];
  level: AdminPerformanceReviewItem["level"];
  score: number;
  title: string;
  summary: string;
  reason: string;
  actionLabel: string;
  actionType: AdminPerformanceReviewItem["actionType"];
  actionHref: string | null;
  repairReason?: string | null;
  articleId: string | null;
  storeId: string | null;
  store: string | null;
  article: string | null;
  locale: string | null;
  campaignDraft?: AdminCampaignDraft | null;
  evidence: string[];
  metrics: AdminPerformanceReviewItem["metrics"];
  updatedAt: string;
}): AdminPerformanceReviewItem {
  return {
    ...input,
    repairReason: input.repairReason ?? null,
    campaignDraft: input.campaignDraft ?? null,
    score: clampScore(input.score),
    evidence: uniqueStrings(input.evidence),
    metrics: {
      ...input.metrics,
      changePercent: normalizeMaybeNumber(input.metrics.changePercent),
      clicks: normalizeMaybeNumber(input.metrics.clicks),
      ctr: normalizeMaybeNumber(input.metrics.ctr),
      impressions: normalizeMaybeNumber(input.metrics.impressions),
      memoryRisk: normalizeMaybeNumber(input.metrics.memoryRisk),
      opportunityScore: normalizeMaybeNumber(input.metrics.opportunityScore),
      position: normalizeMaybeNumber(input.metrics.position),
      potentialClicks: normalizeMaybeNumber(input.metrics.potentialClicks),
      performanceScore: normalizeMaybeNumber(input.metrics.performanceScore),
      trendPercent: normalizeMaybeNumber(input.metrics.trendPercent),
      trafficLoss: normalizeMaybeNumber(input.metrics.trafficLoss),
      queryCount: normalizeMaybeNumber(input.metrics.queryCount)
    }
  };
}

function performanceRepairReason(input: {
  kind: "quick_win" | "low_ctr" | "declining";
  title: string;
  topQuery: string;
  position: number | null;
  ctr: number;
  expectedCtr: number;
  missedClicks: number;
  trendPercent: number | null;
  trafficLoss: number | null;
  queryCount: number;
  clicks: number;
  impressions: number;
}) {
  const workflow = "SEO Machine workflow: analyze-existing -> rewrite -> optimize -> performance-review.";
  const metrics = [
    `top query "${input.topQuery}"`,
    input.position !== null ? `average position ${input.position.toFixed(1)}` : null,
    `CTR ${(input.ctr * 100).toFixed(1)}% vs expected ${(input.expectedCtr * 100).toFixed(1)}%`,
    input.missedClicks > 0 ? `estimated missed clicks ${input.missedClicks}` : null,
    input.trendPercent !== null ? `performance trend ${input.trendPercent.toFixed(1)}%` : null,
    input.trafficLoss !== null ? `traffic loss signal ${input.trafficLoss}` : null,
    `queries ${input.queryCount}`,
    `clicks ${input.clicks}`,
    `impressions ${input.impressions}`
  ].filter(Boolean);
  const instruction =
    input.kind === "quick_win"
      ? "Push this page-two opportunity toward page one with stronger answer-first copy, query-matched H2s, internal links, and sharper buyer comparison."
      : input.kind === "low_ctr"
        ? "Rewrite title, meta summary, opening answer, and first decision block to improve click appeal without inventing claims."
        : "Refresh stale sections, add recent evidence or product context, update FAQs, and preserve any ranking query intent that still works.";

  return `${workflow} ${instruction} Article: ${input.title}. Evidence: ${metrics.join("; ")}.`;
}

function calcChangePercent(previous: number, current: number) {
  if (previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function calcGrowthPercent(previous: number, current: number) {
  if (previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function scoreSearchConsoleSnapshot(snapshot: {
  clicks: number;
  impressions: number;
  position: number | null;
  performanceScore: number | null;
}) {
  return snapshot.performanceScore ?? clampScore(
    Math.min(100, (snapshot.impressions > 0 ? Math.log10(snapshot.impressions + 1) * 18 : 0) + (snapshot.clicks > 0 ? Math.log10(snapshot.clicks + 1) * 22 : 0) + (snapshot.position ? Math.max(0, 25 - snapshot.position) : 0))
  );
}

function expectedCtrForPosition(position: number | null) {
  if (position === null) return 0.03;
  if (position <= 1) return 0.316;
  if (position <= 2) return 0.157;
  if (position <= 3) return 0.105;
  if (position <= 5) return 0.059;
  if (position <= 10) return 0.027;
  if (position <= 15) return 0.015;
  if (position <= 20) return 0.011;
  return 0.008;
}

function estimatePotentialClicks(impressions: number | null, ctr: number | null, position: number | null) {
  if (!impressions || impressions <= 0) return null;
  const expected = expectedCtrForPosition(position);
  const current = ctr ?? 0;
  return Math.max(0, Math.round(impressions * Math.max(0, expected - current)));
}

function groupByArticleId<T extends { articleId: string; syncedAt?: Date }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.articleId) ?? [];
    list.push(row);
    grouped.set(row.articleId, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => {
      const leftTime = left.syncedAt instanceof Date ? left.syncedAt.getTime() : 0;
      const rightTime = right.syncedAt instanceof Date ? right.syncedAt.getTime() : 0;
      return rightTime - leftTime;
    });
  }
  return grouped;
}

function groupSnapshotsByArticleId<T extends { articleId: string; syncedAt: Date | string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.articleId) ?? [];
    list.push(row);
    grouped.set(row.articleId, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => dateTimeValue(right.syncedAt) - dateTimeValue(left.syncedAt));
  }
  return grouped;
}

function dateTimeValue(value: Date | string) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function deriveArticleMemoryRisk(articleId: string, memories: PriorityMemoryRow[]) {
  let risk = 0;
  for (const memory of memories) {
    if (memory.article?.id !== articleId) continue;
    risk += memoryRiskScore(memory) >= 80 ? 18 : memoryRiskScore(memory) >= 60 ? 10 : 0;
  }
  return Math.min(100, risk);
}

function deriveRunMemoryRisk(run: PriorityTopicRunRow, memories: PriorityMemoryRow[]) {
  const keyword = run.selectedCandidate?.primaryKeyword ?? run.selectedTopic ?? run.article?.title ?? "";
  const angleKey = run.selectedCandidate?.angleKey ?? "";
  let risk = 0;
  for (const memory of memories) {
    if (memory.storeId !== run.storeId) continue;
    if (memory.angleKey && angleKey && memory.angleKey === angleKey && memory.avoidUntil && memory.avoidUntil.getTime() > Date.now()) {
      risk += memory.confidence >= 80 ? 35 : 22;
    }
    if (memory.keyword && keyword && tokenOverlap(memory.keyword, keyword) >= 0.65) {
      risk += memory.outcome === "failed" || memory.outcome === "rejected" ? 20 : 10;
    }
  }
  return Math.min(100, risk);
}

function memoryRiskScore(memory: PriorityMemoryRow) {
  let risk = 40;
  if (memory.outcome === "failed" || memory.outcome === "rejected") risk += 25;
  if (memory.outcome === "warning") risk += 12;
  if (memory.avoidUntil && memory.avoidUntil.getTime() > Date.now()) risk += 15;
  if (memory.confidence >= 80) risk += 8;
  if (memory.qualityScore !== null && memory.qualityScore < 75) risk += 5;
  return Math.min(100, risk);
}

function tokenOverlap(left: string, right: string) {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const token of a) {
    if (b.has(token)) hit += 1;
  }
  return hit / Math.min(a.size, b.size);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((item) => item.length >= 3);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeMaybeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
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

function campaignProgressState(campaign: {
  status: string;
  metadata?: unknown;
  updatedAt: Date;
  articles: Array<{ id?: string; status: string }>;
}) {
  const metadata = asRecord(campaign.metadata);
  const progress = asRecord(metadata.generationProgress);
  const percent = numberValue(progress.percent);
  const label = stringValue(progress.label);
  const step = stringValue(progress.step);
  const detail = stringValue(progress.detail);
  const updatedAt = stringValue(progress.updatedAt) ?? campaign.updatedAt.toISOString();
  const stage = stringValue(progress.stage);
  const nextStep = stringValue(progress.nextStep);
  const articleId = stringValue(progress.articleId) ?? campaign.articles[0]?.id ?? null;
  const stale = campaignProgressStaleState({
    status: campaign.status,
    percent: typeof percent === "number" ? percent : campaignProgress(campaign),
    updatedAt,
    label,
    stage,
    step
  });
  const recoverable = Boolean(progress.recoverable) || stale.isStale;

  if (campaign.status === "active" && typeof percent === "number") {
    return {
      percent,
      label: label ?? campaignProgressLabel(step, campaign.status),
      step,
      detail,
      updatedAt,
      stage,
      nextStep,
      recoverable,
      articleId,
      ...stale
    };
  }

  const fallbackPercent = campaignProgress(campaign);
  return {
    percent: fallbackPercent,
    label: campaignProgressLabel(step, campaign.status),
    step,
    detail,
    updatedAt,
    stage,
    nextStep,
    recoverable,
    articleId,
    ...stale
  };
}

function campaignProgressStaleState(input: {
  status: string;
  percent: number;
  updatedAt: string | null;
  label: string | null;
  stage: string | null;
  step: string | null;
}) {
  if (input.status !== "active" || input.percent >= 100 || !input.updatedAt) {
    return {
      isStale: false,
      staleMinutes: null,
      staleReason: null
    };
  }

  const updatedAtMs = Date.parse(input.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return {
      isStale: false,
      staleMinutes: null,
      staleReason: null
    };
  }

  const staleMinutes = Math.max(0, Math.floor((Date.now() - updatedAtMs) / 60000));
  if (staleMinutes < ACTIVE_CAMPAIGN_STALE_MINUTES) {
    return {
      isStale: false,
      staleMinutes,
      staleReason: null
    };
  }

  const stageLabel = [input.stage, input.label ?? campaignProgressLabel(input.step, input.status)].filter(Boolean).join(" · ");
  return {
    isStale: true,
    staleMinutes,
    staleReason: `${stageLabel || "当前任务"} 已 ${staleMinutes} 分钟没有进度心跳，建议先查看日志；如果已生成草稿，可以进入文章页触发 AI 修复。`
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

function searchConsolePropertyTone(status: string): AdminSearchConsolePropertyOverview["statusTone"] {
  if (status === "active") return "good";
  if (status === "needs_auth") return "warn";
  if (status === "disconnected") return "danger";
  return "neutral";
}

async function getLocaleFallbacks(organizationId: string) {
  const localeConfigs = await repository.findLocaleConfigs(organizationId);
  const fallbacks = new Map<string, string>();

  for (const config of localeConfigs) {
    if (!fallbacks.has(config.storeId)) {
      fallbacks.set(config.storeId, config.locale);
    }
    if (config.isDefault) {
      fallbacks.set(config.storeId, config.locale);
    }
  }

  return fallbacks;
}

function resolveLocaleForStore(storeId: string, fallbacks: Map<string, string>, defaultLocale: string) {
  return fallbacks.get(storeId) ?? defaultLocale;
}

function buildCampaignActionHref(input: {
  storeId: string;
  locale: string;
  topic: string | null;
  primaryKeyword: string | null;
  keywords: string[];
  targetWordCount: number;
}) {
  const params = new URLSearchParams();
  params.set("storeId", input.storeId);
  params.set("locale", input.locale);
  params.set("topicDiscoveryEnabled", "false");
  params.set("sourceType", "manual_topic");
  params.set("publishPolicy", "manual_review");
  params.set("targetWordCount", String(input.targetWordCount));

  if (input.topic) params.set("topic", input.topic);
  if (input.primaryKeyword) params.set("primaryKeyword", input.primaryKeyword);
  if (input.keywords.length > 0) params.set("keywords", input.keywords.join(", "));

  return `/campaigns?${params.toString()}#new-campaign`;
}

function buildResearchViewFromAdminViews(
  mode: AdminResearchMode,
  priorities: AdminPriorityBoardView,
  performance: AdminPerformanceReviewView,
  searchConsole: AdminSearchConsoleView,
  topicRuns: PriorityTopicRunRow[],
  campaigns: CampaignRow[],
  properties: SearchConsolePropertyRow[]
): AdminResearchView {
  const prioritySignals = priorities.items.map(priorityItemToResearchSignal);
  const performanceSignals = performance.items.map(performanceItemToResearchSignal);
  const topicRunActions = buildTopicRunActions(topicRuns, performance.items);
  const signals = dedupeResearchSignals([...prioritySignals, ...performanceSignals, ...topicRunActions.map(topicRunActionToResearchSignal)]).sort(
    (left, right) => right.score - left.score
  );
  const clusters = buildResearchClusters(priorities.items, performance.items, [], campaigns);
  const trends = buildResearchTrends(performance.items, []);
  const performanceMatrix = buildResearchPerformanceMatrix(performance.items, [], [] as PerformanceReviewSnapshotRow[]);

  return {
    organization: priorities.organization.id ? priorities.organization : performance.organization,
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
      topicRuns: topicRunActions.length,
      searchConsoleProperties: properties.length
    },
    signals,
    clusters,
    trends,
    performanceMatrix,
    topicRunActions,
    topicRuns: performance.items,
    notes: [
      "统一视图把优先级、性能复盘、Search Console 和主题运行合并成可执行信号。",
      "先处理快赢、低 CTR 和竞争缺口，再推进主题集群与趋势内容。"
    ]
  };
}

function buildResearchSignalsFromSearchConsole(
  snapshots: SearchConsoleSnapshotRow[],
  campaigns: CampaignRow[]
): AdminResearchSignal[] {
  const latestByArticle = groupSnapshotsByArticleId(snapshots);
  const items: AdminResearchSignal[] = [];

  for (const [articleId, rows] of latestByArticle.entries()) {
    const latest = rows[0];
    const previous = rows[1] ?? null;
    const trendPercent = previous ? calcChangePercent(previous.clicks + previous.impressions, latest.clicks + latest.impressions) : null;
    const authority = clampScore(scoreSearchConsoleSnapshot(latest));

    if (latest.position !== null && latest.position >= 11 && latest.position <= 20) {
      items.push(
        createResearchSignal({
          id: `research-search-console-quick-win-${latest.id}`,
          title: latest.article.title ?? "Untitled article",
          subtitle: "页二关键词可以直接推进到可点击区间。",
          score: clampScore(90 - latest.position * 2 + Math.min(10, Math.log10(latest.impressions + 1) * 2)),
          tone: latest.position <= 15 ? "high" : "medium",
          kind: "quick_win",
          source: latest.property.siteUrl,
          actionLabel: "查看文章",
          actionType: "review_article",
          actionHref: latest.articleId ? `/articles/${latest.articleId}` : null,
          evidence: [`Position ${latest.position.toFixed(1)}`, `CTR ${(latest.ctr * 100).toFixed(1)}%`],
          metrics: {
            clicks: latest.clicks,
            impressions: latest.impressions,
            ctr: latest.ctr,
            position: latest.position,
            performanceScore: latest.performanceScore,
            changePercent: trendPercent,
            opportunityScore: authority,
            memoryRisk: null,
            potentialClicks: estimatePotentialClicks(latest.impressions, latest.ctr, latest.position)
          },
          relatedItems: [latest.article.title ?? "", latest.store.name].filter(Boolean)
        })
      );
    }
  }

  for (const campaign of campaigns) {
    if (!campaign.topic || campaign.sourceType !== "manual_topic") continue;
    items.push(
      createResearchSignal({
        id: `research-campaign-gap-${campaign.id}`,
        title: campaign.title,
        subtitle: "现有内容任务可以继续拆分为更细的主题集群。",
        score: clampScore(70 + Math.min(20, campaign.articles.length * 2)),
        tone: "medium",
        kind: "gap",
        source: campaign.store.name,
        actionLabel: "打开任务",
        actionType: "open_campaign",
        actionHref: `/campaigns?campaignId=${encodeURIComponent(campaign.id)}`,
        evidence: [campaign.topic, campaign.primaryKeyword].filter(Boolean) as string[],
        metrics: {
          clicks: null,
          impressions: null,
          ctr: null,
          position: null,
          opportunityScore: null,
          memoryRisk: null,
          potentialClicks: null,
          performanceScore: null,
          changePercent: null
        },
        relatedItems: [campaign.store.name, campaign.title].filter(Boolean)
      })
    );
  }

  return dedupeResearchSignals(items).slice(0, 20);
}

function buildResearchClusters(
  priorityItems: AdminPriorityBoardItem[],
  performanceItems: AdminPerformanceReviewItem[],
  snapshots: SearchConsoleSnapshotRow[],
  campaigns: CampaignRow[]
): AdminResearchCluster[] {
  const clusters: AdminResearchCluster[] = [];
  const topicBuckets = new Map<string, SearchConsoleSnapshotRow[]>();

  for (const snapshot of snapshots) {
    const articleTitle = snapshot.article.title ?? "Untitled article";
    const topic = snapshot.topQuery ?? articleTitle.split(/\s+/).slice(0, 3).join(" ");
    const list = topicBuckets.get(topic) ?? [];
    list.push(snapshot);
    topicBuckets.set(topic, list);
  }

  for (const [topic, rows] of topicBuckets.entries()) {
    const totalImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const positions = rows.map((row) => row.position).filter((value): value is number => value !== null);
    const avgPosition = positions.length ? positions.reduce((sum, value) => sum + value, 0) / positions.length : null;
    const authorityScore = clampScore(Math.min(100, totalImpressions / 20 + (avgPosition ? Math.max(0, 30 - avgPosition) * 2 : 0)));

    clusters.push({
      topic,
      primaryKeyword: rows[0]?.topQuery ?? topic,
      authorityScore,
      authorityLevel: authorityLevelForScore(authorityScore),
      keywordCount: rows.length,
      totalImpressions,
      avgPosition,
      gapCount: rows.filter((row) => (row.position ?? 99) > 10).length,
      topKeywords: rows.map((row) => row.topQuery).filter(Boolean).slice(0, 5) as string[],
      gapKeywords: rows.filter((row) => (row.position ?? 99) > 10).map((row) => row.topQuery ?? row.article.title ?? "Untitled article").slice(0, 5),
      actionHref: rows[0]?.articleId ? `/articles/${rows[0].articleId}` : "/campaigns",
      actionLabel: "查看集群"
    });
  }

  for (const item of performanceItems) {
    if (item.kind !== "trend" && item.kind !== "topic_opportunity") continue;
    clusters.push({
      topic: item.campaignDraft?.topic ?? item.title,
      primaryKeyword: item.campaignDraft?.primaryKeyword ?? item.title,
      authorityScore: item.score,
      authorityLevel: authorityLevelForScore(item.score),
      keywordCount: item.campaignDraft?.keywords.length ?? 0,
      totalImpressions: item.metrics.impressions ?? 0,
      avgPosition: item.metrics.position,
      gapCount: Math.max(1, item.evidence.length),
      topKeywords: item.campaignDraft?.keywords.slice(0, 5) ?? [],
      gapKeywords: item.evidence.slice(0, 5),
      actionHref: item.actionHref,
      actionLabel: item.actionLabel
    });
  }

  for (const campaign of campaigns) {
    clusters.push({
      topic: campaign.topic ?? campaign.title,
      primaryKeyword: campaign.primaryKeyword ?? campaign.topic ?? campaign.title,
      authorityScore: clampScore(50 + campaign.articles.length * 3),
      authorityLevel: authorityLevelForScore(50 + campaign.articles.length * 3),
      keywordCount: campaign.keywords.length,
      totalImpressions: 0,
      avgPosition: null,
      gapCount: campaign.keywords.length,
      topKeywords: campaign.keywords.slice(0, 5),
      gapKeywords: campaign.keywords.slice(0, 5),
      actionHref: `/campaigns?campaignId=${encodeURIComponent(campaign.id)}`,
      actionLabel: "打开任务"
    });
  }

  return dedupeClusters(clusters).slice(0, 12);
}

function buildResearchTrends(
  performanceItems: AdminPerformanceReviewItem[],
  snapshots: SearchConsoleSnapshotRow[]
): AdminResearchTrend[] {
  const trends: AdminResearchTrend[] = [];
  const groupedSnapshots = groupSnapshotsByArticleId(snapshots);

  for (const [articleId, rows] of groupedSnapshots.entries()) {
    if (rows.length < 2) continue;
    const latest = rows[0];
    const previous = rows[1];
    const growthPercent = calcGrowthPercent(previous.impressions, latest.impressions);
    if (growthPercent === null) continue;

    trends.push({
      keyword: latest.topQuery ?? latest.article.title ?? "Untitled article",
      growthPercent,
      position: latest.position,
      impressions: latest.impressions,
      score: clampScore(60 + Math.min(30, growthPercent / 2)),
      priority: growthPercent >= 100 ? "CRITICAL" : growthPercent >= 40 ? "HIGH" : "MEDIUM",
      urgency: growthPercent >= 80 ? "立即跟进" : "持续观察",
      searchIntent: "内容增长",
      actionHref: latest.articleId ? `/articles/${latest.articleId}` : `/campaigns?articleId=${encodeURIComponent(articleId)}`
    });
  }

  for (const item of performanceItems) {
    if ((item.metrics.trendPercent ?? item.metrics.changePercent ?? 0) <= 0) continue;
    trends.push({
      keyword: item.campaignDraft?.primaryKeyword ?? item.title,
      growthPercent: item.metrics.trendPercent ?? item.metrics.changePercent ?? 0,
      position: item.metrics.position,
      impressions: item.metrics.impressions ?? 0,
      score: item.score,
      priority: item.level === "critical" || item.level === "high" ? "HIGH" : "MEDIUM",
      urgency: item.reason,
      searchIntent: item.kind === "trend" ? "趋势捕获" : "内容更新",
      actionHref: item.actionHref
    });
  }

  return dedupeTrends(trends).sort((left, right) => right.score - left.score).slice(0, 12);
}

function buildResearchPerformanceMatrix(
  performanceItems: AdminPerformanceReviewItem[],
  snapshots: SearchConsoleSnapshotRow[],
  reviewSnapshots: PerformanceReviewSnapshotRow[]
): AdminResearchPerformanceMatrixItem[] {
  const items: AdminResearchPerformanceMatrixItem[] = [];

  for (const snapshot of snapshots) {
    const seoScore = snapshot.performanceScore ?? scoreSearchConsoleSnapshot(snapshot);
    items.push({
      title: snapshot.article.title ?? "Untitled article",
      path: snapshot.pageUrl,
      category: matrixCategoryFromMetrics(snapshot.position, snapshot.ctr, snapshot.impressions),
      priority: priorityLevelForScore(seoScore),
      clicks: snapshot.clicks,
      impressions: snapshot.impressions,
      ctr: snapshot.ctr,
      avgPosition: snapshot.position ?? 0,
      trendPercent: 0,
      seoScore: snapshot.performanceScore,
      action: "查看文章",
      actionHref: snapshot.articleId ? `/articles/${snapshot.articleId}` : null
    });
  }

  for (const snapshot of reviewSnapshots) {
    items.push({
      title: snapshot.article.title ?? "Untitled article",
      path: snapshot.article.canonicalUrl ?? `/articles/${snapshot.articleId}`,
      category: snapshot.position !== null && snapshot.position <= 3 ? "Star" : snapshot.position !== null && snapshot.position <= 10 ? "Overperformer" : "Underperformer",
      priority: priorityLevelForScore(snapshot.performanceScore ?? 0),
      clicks: snapshot.clicks,
      impressions: snapshot.impressions,
      ctr: snapshot.ctr,
      avgPosition: snapshot.position ?? 0,
      trendPercent: 0,
      seoScore: snapshot.performanceScore,
      action: "查看复盘",
      actionHref: `/articles/${snapshot.articleId}`
    });
  }

  for (const item of performanceItems) {
    if (!item.articleId && item.kind !== "declining" && item.kind !== "low_ctr" && item.kind !== "quick_win") continue;
    items.push({
      title: item.article ?? item.title,
      path: item.actionHref ?? "",
      category: matrixCategoryFromKind(item.kind),
      priority: priorityLevelForScore(item.score),
      clicks: item.metrics.clicks ?? 0,
      impressions: item.metrics.impressions ?? 0,
      ctr: item.metrics.ctr ?? 0,
      avgPosition: item.metrics.position ?? 0,
      trendPercent: item.metrics.trendPercent ?? item.metrics.changePercent ?? 0,
      seoScore: item.metrics.performanceScore,
      action: item.actionLabel,
      actionHref: item.actionHref
    });
  }

  return dedupeMatrixItems(items).slice(0, 20);
}

function buildTopicRunActions(
  topicRuns: PriorityTopicRunRow[],
  performanceItems: AdminPerformanceReviewItem[]
): AdminResearchTopicRunAction[] {
  return topicRuns
    .map((run): AdminResearchTopicRunAction | null => {
      const selected = run.selectedCandidate;
      if (!selected) return null;
      const linkedItem = performanceItems.find((item) => item.articleId === run.article?.id && item.kind === "topic_opportunity");
      const actionHref = run.article?.id ? `/articles/${run.article.id}` : "/campaigns";
      const score = linkedItem?.score ?? selected.opportunityScore ?? selected.score ?? run.article?.seoScore ?? 0;

      return {
        id: `topic-run-action-${run.id}`,
        topicRunId: run.id,
        title: run.selectedTopic ?? selected.topic,
        summary: run.objective ?? selected.rejectedReason ?? "Topic run is ready for action.",
        reason: selected.rejectedReason ?? run.objective ?? "Topic run produced a usable content path.",
        score: clampScore(score),
        level: score >= 85 ? "high" : score >= 70 ? "medium" : "low",
        kind: run.article?.id ? "topic_refresh" : "topic_opportunity",
        source: run.store.name,
        actionLabel: run.article?.id ? "查看文章" : "查看运行",
        actionType: run.article?.id ? "review_article" : "view_run",
        actionHref,
        articleId: run.article?.id ?? null,
        campaignId: run.campaign?.id ?? null,
        storeId: run.store.id,
        store: run.store.name,
        article: run.article?.title ?? null,
        campaign: run.campaign?.title ?? null,
        locale: run.locale,
        evidence: uniqueStrings([
          `Run ${run.runId}`,
          `Selected ${selected.topic}`,
          selected.angleKey ? `Angle ${selected.angleKey}` : null,
          selected.primaryKeyword ? `Keyword ${selected.primaryKeyword}` : null,
          run.steps.length ? `Steps ${run.steps.length}` : null
        ].filter((value): value is string => Boolean(value))),
        metrics: {
          clicks: run.article?.seoScore ?? null,
          impressions: null,
          ctr: null,
          position: null,
          performanceScore: run.article?.seoScore ?? null,
          changePercent: null,
          opportunityScore: selected.opportunityScore ?? selected.score ?? null,
          memoryRisk: deriveRunMemoryRisk(run, []),
          potentialClicks: null,
          trendPercent: null,
          trafficLoss: null,
          queryCount: null
        },
        updatedAt: run.updatedAt.toISOString()
      } satisfies AdminResearchTopicRunAction;
    })
    .filter((item): item is AdminResearchTopicRunAction => item !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
}

function buildResearchNotes(input: {
  campaigns: CampaignRow[];
  properties: SearchConsolePropertyRow[];
  priorityItems: AdminPriorityBoardItem[];
  performanceItems: AdminPerformanceReviewItem[];
  topicRuns: PriorityTopicRunRow[];
  searchConsole: SearchConsoleSnapshotRow[];
}) {
  const notes = [
    `覆盖 ${input.campaigns.length} 个内容任务、${input.properties.length} 个 Search Console 资产。`,
    `识别到 ${input.priorityItems.length} 个优先级信号与 ${input.performanceItems.length} 个性能复盘项。`
  ];
  if (input.topicRuns.length > 0) notes.push(`最近有 ${input.topicRuns.length} 个主题运行可直接转成行动。`);
  if (input.searchConsole.length > 0) notes.push(`Search Console 快赢和趋势信号会优先进入研究页。`);
  return notes;
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

function topicRunActionToResearchSignal(item: AdminResearchTopicRunAction): AdminResearchSignal {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.summary,
    score: item.score,
    tone: item.level,
    kind: item.kind === "topic_refresh" ? "topic_opportunity" : item.kind === "topic_gap" ? "gap" : item.kind === "topic_cluster" ? "cluster" : "topic_opportunity",
    source: item.source,
    actionLabel: item.actionLabel,
    actionType: item.actionType,
    actionHref: item.actionHref,
    evidence: item.evidence,
    metrics: item.metrics,
    relatedItems: [item.store, item.article, item.campaign, item.locale].filter(Boolean) as string[]
  };
}

function createResearchSignal(input: {
  id: string;
  title: string;
  subtitle: string;
  score: number;
  tone: AdminPriorityLevel;
  kind: AdminResearchSignal["kind"];
  source: string;
  actionLabel: string;
  actionType: AdminPriorityActionType;
  actionHref: string | null;
  evidence: string[];
  metrics: AdminResearchSignal["metrics"];
  relatedItems: string[];
}): AdminResearchSignal {
  return {
    ...input,
    score: clampScore(input.score),
    evidence: uniqueStrings(input.evidence),
    relatedItems: uniqueStrings(input.relatedItems)
  };
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

function dedupeClusters(clusters: AdminResearchCluster[]) {
  const seen = new Set<string>();
  return clusters.filter((cluster) => {
    const key = cluster.topic.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeTrends(trends: AdminResearchTrend[]) {
  const seen = new Set<string>();
  return trends.filter((trend) => {
    const key = trend.keyword.toLowerCase();
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

function authorityLevelForScore(score: number): AdminResearchCluster["authorityLevel"] {
  if (score >= 85) return "Strong";
  if (score >= 65) return "Moderate";
  if (score >= 40) return "Weak";
  return "Minimal";
}

function priorityLevelForScore(score: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 90) return "CRITICAL";
  if (score >= 75) return "HIGH";
  if (score >= 55) return "MEDIUM";
  return "LOW";
}

function matrixCategoryFromMetrics(position: number | null, ctr: number, impressions: number): AdminResearchPerformanceMatrixItem["category"] {
  if (position !== null && position <= 3 && ctr >= 0.05) return "Star";
  if (position !== null && position <= 10 && ctr >= 0.02) return "Overperformer";
  if (position !== null && position > 10 && impressions >= 100) return "Underperformer";
  return "Declining";
}

function matrixCategoryFromKind(kind: AdminPerformanceReviewItem["kind"]): AdminResearchPerformanceMatrixItem["category"] {
  if (kind === "quick_win") return "Overperformer";
  if (kind === "declining") return "Declining";
  return "Underperformer";
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
