import type { Job } from "bullmq";
import {
  QUEUE_NAMES,
  SHOPIFY_SYNC_JOB_NAMES,
  type CollectionSyncJobData,
  type ProductSyncJobData,
  type ShopifySyncJobData,
  type ShopifySyncJobName,
  type WorkerJobResult
} from "../queues";

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

  return {
    ok: true,
    queue: QUEUE_NAMES.shopifySync,
    jobName: SHOPIFY_SYNC_JOB_NAMES.productSync,
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    message: "Product sync job accepted by worker.",
    processedAt: new Date().toISOString(),
    counts: {
      products: job.data.productIds?.length ?? 0
    }
  };
}

function throwUnsupportedShopifySyncJob(jobName: never): never {
  throw new Error(`Unsupported Shopify sync job: ${String(jobName)}`);
}

async function syncCollections(
  job: Job<CollectionSyncJobData, WorkerJobResult, typeof SHOPIFY_SYNC_JOB_NAMES.collectionSync>
): Promise<WorkerJobResult> {
  await job.updateProgress({ step: "collections:syncing", fullSync: job.data.fullSync ?? false });
  await job.log(`Syncing collections for store ${job.data.storeId}`);

  return {
    ok: true,
    queue: QUEUE_NAMES.shopifySync,
    jobName: SHOPIFY_SYNC_JOB_NAMES.collectionSync,
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    message: "Collection sync job accepted by worker.",
    processedAt: new Date().toISOString(),
    counts: {
      collections: job.data.collectionIds?.length ?? 0
    }
  };
}
