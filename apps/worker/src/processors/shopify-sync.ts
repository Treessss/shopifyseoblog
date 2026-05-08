import type { Job } from "bullmq";
import { maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import {
  createShopifyGraphQLClient,
  listCollections,
  listProducts,
  type ShopifyCollection,
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

export type ShopifySyncJob = Job<ShopifySyncJobData, WorkerJobResult, ShopifySyncJobName>;

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

  const publishJob = await startPublishJob({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
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
    storeId: job.data.storeId,
    jobId: publishJob.id,
    event: "started",
    message: "Product snapshot sync started.",
    payload: { bullJobId: job.id }
  });

  try {
    const store = await loadStore(job.data.organizationId, job.data.storeId);
    const client = createStoreClient(store);
    const connection = await listProducts(client, {
      first: normalizeLimit(job.data.limit),
      after: job.data.cursor
    });
    const products = filterByIds(connection.nodes, job.data.productIds);
    const syncedAt = new Date();

    await Promise.all(products.map((product) => upsertProductSnapshot(product, job.data, syncedAt)));
    await prisma.shopifyStore.update({
      where: { id: job.data.storeId },
      data: { lastSyncedAt: syncedAt }
    });

    await completePublishJob(publishJob.id, {
      products: products.length,
      pageInfo: connection.pageInfo
    });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      jobId: publishJob.id,
      event: "succeeded",
      message: "Product snapshot sync completed.",
      payload: {
        products: products.length,
        pageInfo: connection.pageInfo
      }
    });
    await writeAuditLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      action: "sync",
      entityType: "ProductSnapshot",
      metadata: {
        products: products.length,
        fullSync: job.data.fullSync ?? false,
        requestedByUserId: job.data.requestedByUserId
      }
    });
    await job.updateProgress({
      step: "products:synced",
      products: products.length,
      nextCursor: connection.pageInfo.endCursor,
      hasNextPage: connection.pageInfo.hasNextPage
    });

    return {
      ok: true,
      queue: QUEUE_NAMES.shopifySync,
      jobName: SHOPIFY_SYNC_JOB_NAMES.productSync,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      message: "Product sync completed.",
      processedAt: new Date().toISOString(),
      counts: {
        products: products.length
      }
    };
  } catch (error) {
    const message = errorMessage(error);
    await failPublishJob(publishJob.id, message, { bullJobId: job.id });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      jobId: publishJob.id,
      event: "failed",
      level: "error",
      message: "Product snapshot sync failed.",
      payload: { error: message }
    });
    throw error;
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

  const publishJob = await startPublishJob({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
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
    storeId: job.data.storeId,
    jobId: publishJob.id,
    event: "started",
    message: "Collection snapshot sync started.",
    payload: { bullJobId: job.id }
  });

  try {
    const store = await loadStore(job.data.organizationId, job.data.storeId);
    const client = createStoreClient(store);
    const connection = await listCollections(client, {
      first: normalizeLimit(job.data.limit),
      after: job.data.cursor
    });
    const collections = filterByIds(connection.nodes, job.data.collectionIds);
    const syncedAt = new Date();

    await Promise.all(
      collections.map((collection) => upsertCollectionSnapshot(collection, job.data, syncedAt))
    );
    await prisma.shopifyStore.update({
      where: { id: job.data.storeId },
      data: { lastSyncedAt: syncedAt }
    });

    await completePublishJob(publishJob.id, {
      collections: collections.length,
      pageInfo: connection.pageInfo
    });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      jobId: publishJob.id,
      event: "succeeded",
      message: "Collection snapshot sync completed.",
      payload: {
        collections: collections.length,
        pageInfo: connection.pageInfo
      }
    });
    await writeAuditLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      action: "sync",
      entityType: "CollectionSnapshot",
      metadata: {
        collections: collections.length,
        fullSync: job.data.fullSync ?? false,
        requestedByUserId: job.data.requestedByUserId
      }
    });
    await job.updateProgress({
      step: "collections:synced",
      collections: collections.length,
      nextCursor: connection.pageInfo.endCursor,
      hasNextPage: connection.pageInfo.hasNextPage
    });

    return {
      ok: true,
      queue: QUEUE_NAMES.shopifySync,
      jobName: SHOPIFY_SYNC_JOB_NAMES.collectionSync,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      message: "Collection sync completed.",
      processedAt: new Date().toISOString(),
      counts: {
        collections: collections.length
      }
    };
  } catch (error) {
    const message = errorMessage(error);
    await failPublishJob(publishJob.id, message, { bullJobId: job.id });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      jobId: publishJob.id,
      event: "failed",
      level: "error",
      message: "Collection snapshot sync failed.",
      payload: { error: message }
    });
    throw error;
  }
}

async function loadStore(organizationId: string, storeId: string) {
  const store = await prisma.shopifyStore.findFirst({
    where: {
      id: storeId,
      organizationId
    }
  });

  if (!store) {
    throw new Error(`Store ${storeId} was not found for organization ${organizationId}.`);
  }

  return store;
}

function createStoreClient(store: {
  myshopifyDomain: string;
  adminAccessTokenEncrypted: string | null;
  apiVersion: string;
}) {
  const accessToken = maybeDecryptSecret(store.adminAccessTokenEncrypted);
  if (!accessToken) {
    throw new Error(`Store ${store.myshopifyDomain} does not have an admin access token.`);
  }

  return createShopifyGraphQLClient({
    shopDomain: store.myshopifyDomain,
    accessToken,
    apiVersion: store.apiVersion
  });
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isInteger(limit)) return 50;
  return Math.max(1, Math.min(limit, 250));
}

function filterByIds<TNode extends { id: string }>(nodes: TNode[], ids: string[] | undefined): TNode[] {
  if (!ids || ids.length === 0) return nodes;
  const wanted = new Set(ids);
  return nodes.filter((node) => wanted.has(node.id));
}

function upsertProductSnapshot(
  product: ShopifyProduct,
  data: ProductSyncJobData,
  syncedAt: Date
) {
  const snapshot = {
    organizationId: data.organizationId,
    storeId: data.storeId,
    shopifyProductId: product.id,
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml ?? product.description,
    productType: product.productType,
    vendor: product.vendor,
    tags: product.tags ?? [],
    imageUrls: product.featuredImage?.url ? [product.featuredImage.url] : [],
    seoTitle: product.seo?.title,
    seoDescription: product.seo?.description,
    raw: product,
    syncedAt
  };

  return prisma.productSnapshot.upsert({
    where: {
      storeId_shopifyProductId: {
        storeId: data.storeId,
        shopifyProductId: product.id
      }
    },
    update: snapshot,
    create: snapshot
  });
}

function upsertCollectionSnapshot(
  collection: ShopifyCollection,
  data: CollectionSyncJobData,
  syncedAt: Date
) {
  const snapshot = {
    organizationId: data.organizationId,
    storeId: data.storeId,
    shopifyCollectionId: collection.id,
    handle: collection.handle,
    title: collection.title,
    descriptionHtml: collection.descriptionHtml,
    imageUrl: collection.image?.url,
    collectionType: collection.sortOrder,
    raw: collection,
    syncedAt
  };

  return prisma.collectionSnapshot.upsert({
    where: {
      storeId_shopifyCollectionId: {
        storeId: data.storeId,
        shopifyCollectionId: collection.id
      }
    },
    update: snapshot,
    create: snapshot
  });
}
