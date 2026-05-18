import type { Job } from "bullmq";
import { prisma, Prisma } from "@shopify-ai-blog/db";
import {
  createShopifyGraphQLClient,
  listCollections,
  listProducts,
  type ShopifyCollection,
  type ShopifyConnection,
  type ShopifyGraphQLClient,
  type ShopifyProduct
} from "@shopify-ai-blog/shopify";
import {
  QUEUE_NAMES,
  SHOPIFY_SYNC_JOB_NAMES,
  type CollectionSyncJobData,
  type ProductSyncJobData,
  type ShopifySyncJobData,
  type ShopifySyncJobName,
  type WorkerJobResult
} from "../queues";
import {
  completePublishJob,
  errorMessage,
  externalJobId,
  failPublishJob,
  startPublishJob,
  writeAuditLog,
  writePublishLog
} from "./db-helpers";
import {
  clampInteger,
  domainError,
  failureJobStatus,
  failurePayload,
  failurePublishEvent,
  parseIntegerEnv,
  throwForBullMQ,
  toPrismaJson,
  willRetryJob
} from "./shared";
import { resolveFreshStoreAccessToken } from "./shopify-token";

export type ShopifySyncJob = Job<ShopifySyncJobData, WorkerJobResult, ShopifySyncJobName>;

interface WorkerShopifyStore {
  id: string;
  organizationId: string;
  myshopifyDomain: string;
  adminAccessTokenEncrypted: string | null;
  adminAccessTokenExpiresAt: Date | null;
  shopifyClientId: string | null;
  shopifyClientSecretEncrypted: string | null;
  scopes: string[];
  apiVersion: string;
  status: string;
}

export async function processShopifySyncJob(job: ShopifySyncJob): Promise<WorkerJobResult> {
  const jobName = job.name;

  switch (jobName) {
    case SHOPIFY_SYNC_JOB_NAMES.productSync:
      return syncProducts(
        job as Job<ProductSyncJobData, WorkerJobResult, typeof SHOPIFY_SYNC_JOB_NAMES.productSync>
      );
    case SHOPIFY_SYNC_JOB_NAMES.collectionSync:
      return syncCollections(
        job as Job<
          CollectionSyncJobData,
          WorkerJobResult,
          typeof SHOPIFY_SYNC_JOB_NAMES.collectionSync
        >
      );
    default:
      throwUnsupportedShopifySyncJob(jobName);
  }
}

async function syncProducts(
  job: Job<ProductSyncJobData, WorkerJobResult, typeof SHOPIFY_SYNC_JOB_NAMES.productSync>
): Promise<WorkerJobResult> {
  await job.updateProgress({ step: "products:syncing", fullSync: job.data.fullSync ?? false });
  await job.log(`Syncing products for store ${job.data.storeId}`);

  let publishJob: Awaited<ReturnType<typeof startPublishJob>> | undefined;
  let store: WorkerShopifyStore | undefined;

  try {
    const loadedStore = await loadStore(job.data.organizationId, job.data.storeId);
    store = loadedStore;
    publishJob = await startPublishJob({
      organizationId: job.data.organizationId,
      storeId: loadedStore.id,
      type: "sync_product",
      externalJobId: externalJobId(QUEUE_NAMES.shopifySync, SHOPIFY_SYNC_JOB_NAMES.productSync, job),
      payload: {
        productIds: job.data.productIds,
        fullSync: job.data.fullSync ?? false,
        cursor: job.data.cursor,
        limit: job.data.limit
      }
    });

    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: loadedStore.id,
      jobId: publishJob.id,
      event: "started",
      message: "Product snapshot sync started.",
      payload: { bullJobId: job.id }
    });

    const client = await createStoreClient(loadedStore);
    const result = await listAllProducts(client, job.data);
    const products = result.connection.nodes;
    const syncedAt = new Date();

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const product of products) {
        await upsertProductSnapshot(tx, product, loadedStore, syncedAt);
      }

      await tx.shopifyStore.update({
        where: { id: loadedStore.id },
        data: { lastSyncedAt: syncedAt }
      });
    });

    await completePublishJob(publishJob.id, {
      products: products.length,
      pageInfo: result.connection.pageInfo,
      capped: result.capped
    });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: loadedStore.id,
      jobId: publishJob.id,
      event: "succeeded",
      level: result.capped ? "warn" : "info",
      message: result.capped
        ? "Product snapshot sync completed at the configured worker cap."
        : "Product snapshot sync completed.",
      payload: {
        products: products.length,
        pageInfo: result.connection.pageInfo,
        capped: result.capped
      }
    });
    await writeAuditLog({
      organizationId: job.data.organizationId,
      storeId: loadedStore.id,
      action: "sync",
      entityType: "ProductSnapshot",
        entityId: loadedStore.id,
      metadata: {
        products: products.length,
        fullSync: job.data.fullSync ?? false,
        pageInfo: result.connection.pageInfo,
        capped: result.capped,
        correlationId: job.data.correlationId,
        requestedByUserId: job.data.requestedByUserId
      }
    });
    await job.updateProgress({
      step: "products:synced",
      products: products.length,
      nextCursor: result.connection.pageInfo.endCursor,
      hasNextPage: result.connection.pageInfo.hasNextPage,
      capped: result.capped
    });

    return {
      ok: true,
      queue: QUEUE_NAMES.shopifySync,
      jobName: SHOPIFY_SYNC_JOB_NAMES.productSync,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      message: result.capped ? "Product sync persisted up to the configured worker cap." : "Product sync completed.",
      processedAt: new Date().toISOString(),
      counts: {
        products: products.length
      }
    };
  } catch (error) {
    await recordSyncFailure(job, "ProductSnapshot", error, publishJob?.id, store?.id);
    throwForBullMQ(error);
  }
}

function throwUnsupportedShopifySyncJob(jobName: never): never {
  throw new Error(`Unsupported Shopify sync job: ${String(jobName)}`);
}

async function syncCollections(
  job: Job<CollectionSyncJobData, WorkerJobResult, typeof SHOPIFY_SYNC_JOB_NAMES.collectionSync>
): Promise<WorkerJobResult> {
  await job.updateProgress({ step: "collections:syncing", fullSync: job.data.fullSync ?? false });
  await job.log(`Syncing collections for store ${job.data.storeId}`);

  let publishJob: Awaited<ReturnType<typeof startPublishJob>> | undefined;
  let store: WorkerShopifyStore | undefined;

  try {
    const loadedStore = await loadStore(job.data.organizationId, job.data.storeId);
    store = loadedStore;
    publishJob = await startPublishJob({
      organizationId: job.data.organizationId,
      storeId: loadedStore.id,
      type: "sync_collection",
      externalJobId: externalJobId(QUEUE_NAMES.shopifySync, SHOPIFY_SYNC_JOB_NAMES.collectionSync, job),
      payload: {
        collectionIds: job.data.collectionIds,
        fullSync: job.data.fullSync ?? false,
        cursor: job.data.cursor,
        limit: job.data.limit
      }
    });

    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: loadedStore.id,
      jobId: publishJob.id,
      event: "started",
      message: "Collection snapshot sync started.",
      payload: { bullJobId: job.id }
    });

    const client = await createStoreClient(loadedStore);
    const result = await listAllCollections(client, job.data);
    const collections = result.connection.nodes;
    const syncedAt = new Date();

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const collection of collections) {
        await upsertCollectionSnapshot(tx, collection, loadedStore, syncedAt);
      }

      await tx.shopifyStore.update({
        where: { id: loadedStore.id },
        data: { lastSyncedAt: syncedAt }
      });
    });

    await completePublishJob(publishJob.id, {
      collections: collections.length,
      pageInfo: result.connection.pageInfo,
      capped: result.capped
    });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: loadedStore.id,
      jobId: publishJob.id,
      event: "succeeded",
      level: result.capped ? "warn" : "info",
      message: result.capped
        ? "Collection snapshot sync completed at the configured worker cap."
        : "Collection snapshot sync completed.",
      payload: {
        collections: collections.length,
        pageInfo: result.connection.pageInfo,
        capped: result.capped
      }
    });
    await writeAuditLog({
      organizationId: job.data.organizationId,
      storeId: loadedStore.id,
      action: "sync",
      entityType: "CollectionSnapshot",
        entityId: loadedStore.id,
      metadata: {
        collections: collections.length,
        fullSync: job.data.fullSync ?? false,
        pageInfo: result.connection.pageInfo,
        capped: result.capped,
        correlationId: job.data.correlationId,
        requestedByUserId: job.data.requestedByUserId
      }
    });
    await job.updateProgress({
      step: "collections:synced",
      collections: collections.length,
      nextCursor: result.connection.pageInfo.endCursor,
      hasNextPage: result.connection.pageInfo.hasNextPage,
      capped: result.capped
    });

    return {
      ok: true,
      queue: QUEUE_NAMES.shopifySync,
      jobName: SHOPIFY_SYNC_JOB_NAMES.collectionSync,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      message: result.capped
        ? "Collection sync persisted up to the configured worker cap."
        : "Collection sync completed.",
      processedAt: new Date().toISOString(),
      counts: {
        collections: collections.length
      }
    };
  } catch (error) {
    await recordSyncFailure(job, "CollectionSnapshot", error, publishJob?.id, store?.id);
    throwForBullMQ(error);
  }
}

interface ListedResources<TNode> {
  connection: ShopifyConnection<TNode>;
  capped: boolean;
}

async function loadStore(organizationId: string, storeId: string): Promise<WorkerShopifyStore> {
  const store = await prisma.shopifyStore.findFirst({
    where: {
      id: storeId,
      organizationId
    }
  });

  if (!store) {
    throw domainError(
      "STORE_NOT_FOUND",
      `Store ${storeId} was not found for organization ${organizationId}.`
    );
  }

  if (store.status !== "active") {
    throw domainError(
      "STORE_NOT_ACTIVE",
      `Store ${store.myshopifyDomain} is ${store.status}; reconnect or activate Shopify before syncing.`
    );
  }

  return store;
}

async function createStoreClient(store: WorkerShopifyStore): Promise<ShopifyGraphQLClient> {
  const accessToken = await resolveFreshStoreAccessToken(store, "sync");
  return createShopifyGraphQLClient({
    shopDomain: store.myshopifyDomain,
    accessToken,
    apiVersion: store.apiVersion
  });
}

async function listAllProducts(
  client: ShopifyGraphQLClient,
  data: ProductSyncJobData
): Promise<ListedResources<ShopifyProduct>> {
  const query = buildIdSearchQuery(data.productIds);
  const maxItems = resolveMaxSyncItems(data.limit, data.productIds?.length, data.fullSync);
  return listAllPages(maxItems, data.cursor, data.fullSync, (first, after) =>
    listProducts(client, {
      first,
      after,
      query
    })
  );
}

async function listAllCollections(
  client: ShopifyGraphQLClient,
  data: CollectionSyncJobData
): Promise<ListedResources<ShopifyCollection>> {
  const query = buildIdSearchQuery(data.collectionIds);
  const maxItems = resolveMaxSyncItems(data.limit, data.collectionIds?.length, data.fullSync);
  return listAllPages(maxItems, data.cursor, data.fullSync, (first, after) =>
    listCollections(client, {
      first,
      after,
      query
    })
  );
}

async function listAllPages<TNode>(
  maxItems: number,
  cursor: string | undefined,
  fullSync: boolean | undefined,
  listPage: (first: number, after: string | undefined) => Promise<ShopifyConnection<TNode>>
): Promise<ListedResources<TNode>> {
  const nodes: TNode[] = [];
  const edges: ShopifyConnection<TNode>["edges"] = [];
  let pageInfo: ShopifyConnection<TNode>["pageInfo"] = {
    hasNextPage: false,
    hasPreviousPage: Boolean(cursor)
  };
  let after = cursor;

  do {
    const remaining = maxItems - nodes.length;
    if (remaining <= 0) break;

    const connection = await listPage(Math.min(250, remaining), after);
    nodes.push(...connection.nodes);
    edges.push(...connection.edges);
    pageInfo = connection.pageInfo;
    after = connection.pageInfo.endCursor ?? undefined;
  } while (Boolean(fullSync) && pageInfo.hasNextPage && nodes.length < maxItems);

  return {
    connection: {
      nodes,
      edges,
      pageInfo
    },
    capped: pageInfo.hasNextPage && nodes.length >= maxItems
  };
}

async function upsertProductSnapshot(
  tx: Prisma.TransactionClient,
  product: ShopifyProduct,
  store: WorkerShopifyStore,
  syncedAt: Date
): Promise<void> {
  const snapshotData = {
    shopifyProductId: product.id,
    handle: product.handle || fallbackHandle("product", product.id),
    title: product.title || product.id,
    descriptionHtml: product.descriptionHtml ?? product.description ?? null,
    productType: product.productType ?? null,
    vendor: product.vendor ?? null,
    status: product.status ?? null,
    tags: product.tags ?? [],
    imageUrls: uniqueStrings([
      product.featuredImage?.url,
      ...(product.images?.nodes?.map((image) => image.url) ?? [])
    ]),
    seoTitle: product.seo?.title ?? null,
    seoDescription: product.seo?.description ?? null,
    options: toPrismaJson(product.options ?? []),
    variants: toPrismaJson(product.variants?.nodes ?? []),
    raw: toPrismaJson(product),
    syncedAt
  };

  try {
    await tx.productSnapshot.upsert({
      where: {
        storeId_shopifyProductId: {
          storeId: store.id,
          shopifyProductId: product.id
        }
      },
      update: snapshotData,
      create: {
        organizationId: store.organizationId,
        storeId: store.id,
        ...snapshotData
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    await tx.productSnapshot.update({
      where: {
        storeId_handle: {
          storeId: store.id,
          handle: snapshotData.handle
        }
      },
      data: snapshotData
    });
  }
}

async function upsertCollectionSnapshot(
  tx: Prisma.TransactionClient,
  collection: ShopifyCollection,
  store: WorkerShopifyStore,
  syncedAt: Date
): Promise<void> {
  const snapshotData = {
    shopifyCollectionId: collection.id,
    handle: collection.handle || fallbackHandle("collection", collection.id),
    title: collection.title || collection.id,
    descriptionHtml: collection.descriptionHtml ?? null,
    imageUrl: collection.image?.url ?? null,
    collectionType: null,
    ruleSet: undefined,
    seoTitle: null,
    seoDescription: null,
    raw: toPrismaJson(collection),
    syncedAt
  };

  try {
    await tx.collectionSnapshot.upsert({
      where: {
        storeId_shopifyCollectionId: {
          storeId: store.id,
          shopifyCollectionId: collection.id
        }
      },
      update: snapshotData,
      create: {
        organizationId: store.organizationId,
        storeId: store.id,
        ...snapshotData
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    await tx.collectionSnapshot.update({
      where: {
        storeId_handle: {
          storeId: store.id,
          handle: snapshotData.handle
        }
      },
      data: snapshotData
    });
  }
}

async function recordSyncFailure(
  job: ShopifySyncJob,
  entityType: "ProductSnapshot" | "CollectionSnapshot",
  error: unknown,
  publishJobId?: string,
  storeId?: string
): Promise<void> {
  const message = errorMessage(error);
  const retrying = willRetryJob(job, error);

  await job.updateProgress({
    step: retrying ? "sync:retry_scheduled" : "sync:failed",
    error: message
  });
  await job.log(`${job.name} failed: ${message}`);

  if (publishJobId) {
    await failPublishJob(
      publishJobId,
      message,
      {
        bullJobId: job.id,
        error: failurePayload(error),
        attempt: job.attemptsMade + 1
      },
      failureJobStatus(job, error)
    );
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId,
      jobId: publishJobId,
      event: failurePublishEvent(job, error),
      level: retrying ? "warn" : "error",
      message: `${entityType} sync failed.`,
      payload: {
        error: failurePayload(error),
        attempt: job.attemptsMade + 1,
        willRetry: retrying
      }
    });
  }

  await writeAuditLog({
    organizationId: job.data.organizationId,
    storeId,
    action: "sync",
    entityType,
    entityId: storeId ?? job.data.storeId,
    metadata: {
      event: retrying ? "retry_scheduled" : "failed",
      error: failurePayload(error),
      jobName: job.name,
      bullJobId: job.id,
      correlationId: job.data.correlationId,
      requestedByUserId: job.data.requestedByUserId,
      attempt: job.attemptsMade + 1
    }
  });
}

function resolveMaxSyncItems(requestedLimit: number | undefined, explicitCount: number | undefined, fullSync: boolean | undefined): number {
  if (explicitCount && explicitCount > 0) return clampInteger(explicitCount, explicitCount, 1, 250);
  if (requestedLimit !== undefined) return clampInteger(requestedLimit, 50, 1, 2500);
  return fullSync ? parseIntegerEnv("SHOPIFY_SYNC_MAX_ITEMS", 1000) : 50;
}

function buildIdSearchQuery(ids: string[] | undefined): string | undefined {
  const terms = (ids ?? []).map((id) => extractShopifySearchId(id)).filter(Boolean);
  return terms.length > 0 ? terms.map((id) => `id:${id}`).join(" OR ") : undefined;
}

function extractShopifySearchId(value: string): string {
  const trimmed = value.trim();
  const numericGid = trimmed.match(/\/(\d+)$/);
  if (numericGid?.[1]) return numericGid[1];
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
}

function fallbackHandle(prefix: string, shopifyId: string): string {
  const id = extractShopifySearchId(shopifyId) || String(hashString(shopifyId));
  return `${prefix}-${id}`.toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
