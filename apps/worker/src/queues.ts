import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import type { BlogCampaignInput, PublishPolicy, SupportedLocale } from "@shopify-ai-blog/shared";

export const WORKER_QUEUE_PREFIX = process.env.BULLMQ_PREFIX ?? "shopify-ai-blog";

export const QUEUE_NAMES = {
  shopifySync: "shopify-sync",
  blogGeneration: "blog-generation"
} as const;

export const SHOPIFY_SYNC_JOB_NAMES = {
  productSync: "product.sync",
  collectionSync: "collection.sync"
} as const;

export const BLOG_GENERATION_JOB_NAMES = {
  blogGeneration: "blog.generate",
  articlePublish: "article.publish"
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
export type ShopifySyncJobName = (typeof SHOPIFY_SYNC_JOB_NAMES)[keyof typeof SHOPIFY_SYNC_JOB_NAMES];
export type BlogGenerationJobName =
  (typeof BLOG_GENERATION_JOB_NAMES)[keyof typeof BLOG_GENERATION_JOB_NAMES];
export type WorkerJobName = ShopifySyncJobName | BlogGenerationJobName;

export interface WorkerJobMeta {
  organizationId: string;
  storeId: string;
  publishJobId?: string;
  correlationId?: string;
  requestedByUserId?: string;
}

export interface ProductSyncJobData extends WorkerJobMeta {
  cursor?: string;
  limit?: number;
  productIds?: string[];
  fullSync?: boolean;
}

export interface CollectionSyncJobData extends WorkerJobMeta {
  cursor?: string;
  limit?: number;
  collectionIds?: string[];
  fullSync?: boolean;
}

export interface BlogGenerationJobData extends BlogCampaignInput {
  campaignId?: string;
  articleId?: string;
  publishJobId?: string;
  correlationId?: string;
  requestedByUserId?: string;
}

export interface ArticlePublishJobData extends WorkerJobMeta {
  articleId: string;
  locale?: SupportedLocale;
  publishPolicy?: PublishPolicy;
  shopifyBlogId?: string;
  publishAt?: string;
}

export type ShopifySyncJobData = ProductSyncJobData | CollectionSyncJobData;
export type BlogGenerationQueueJobData = BlogGenerationJobData | ArticlePublishJobData;
export type WorkerJobData = ShopifySyncJobData | BlogGenerationQueueJobData;

export interface WorkerJobResult {
  ok: boolean;
  queue: QueueName;
  jobName: WorkerJobName;
  message: string;
  organizationId: string;
  storeId: string;
  processedAt: string;
  counts?: {
    products?: number;
    collections?: number;
    articles?: number;
    published?: number;
  };
  articleId?: string;
}

export type ShopifySyncQueue = Queue<ShopifySyncJobData, WorkerJobResult, ShopifySyncJobName>;
export type BlogGenerationQueue = Queue<
  BlogGenerationQueueJobData,
  WorkerJobResult,
  BlogGenerationJobName
>;

let redisConnection: IORedis | undefined;
let shopifySyncQueue: ShopifySyncQueue | undefined;
let blogGenerationQueue: BlogGenerationQueue | undefined;

export function getRedisConnection(): IORedis {
  if (!redisConnection) {
    redisConnection = new IORedis(getRedisUrl(), getRedisConnectionOptions());
  }

  return redisConnection;
}

export async function closeRedisConnection(): Promise<void> {
  if (!redisConnection) return;

  const connection = redisConnection;
  redisConnection = undefined;

  if (connection.status === "end") return;

  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
}

export function getShopifySyncQueue(): ShopifySyncQueue {
  if (!shopifySyncQueue) {
    shopifySyncQueue = new Queue<ShopifySyncJobData, WorkerJobResult, ShopifySyncJobName>(
      QUEUE_NAMES.shopifySync,
      getQueueOptions()
    );
  }

  return shopifySyncQueue;
}

export function getBlogGenerationQueue(): BlogGenerationQueue {
  if (!blogGenerationQueue) {
    blogGenerationQueue = new Queue<
      BlogGenerationQueueJobData,
      WorkerJobResult,
      BlogGenerationJobName
    >(QUEUE_NAMES.blogGeneration, getQueueOptions());
  }

  return blogGenerationQueue;
}

export async function closeQueues(): Promise<void> {
  const queues = [shopifySyncQueue, blogGenerationQueue].filter(isDefined);
  shopifySyncQueue = undefined;
  blogGenerationQueue = undefined;

  await Promise.all(queues.map((queue) => queue.close()));
  await closeRedisConnection();
}

export function enqueueProductSync(data: ProductSyncJobData, options?: JobsOptions) {
  return getShopifySyncQueue().add(SHOPIFY_SYNC_JOB_NAMES.productSync, data, options);
}

export function enqueueCollectionSync(data: CollectionSyncJobData, options?: JobsOptions) {
  return getShopifySyncQueue().add(SHOPIFY_SYNC_JOB_NAMES.collectionSync, data, options);
}

export function enqueueBlogGeneration(data: BlogGenerationJobData, options?: JobsOptions) {
  return getBlogGenerationQueue().add(BLOG_GENERATION_JOB_NAMES.blogGeneration, data, options);
}

export function enqueueArticlePublish(data: ArticlePublishJobData, options?: JobsOptions) {
  return getBlogGenerationQueue().add(BLOG_GENERATION_JOB_NAMES.articlePublish, data, options);
}

function getQueueOptions(): QueueOptions {
  return {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000
      },
      removeOnComplete: {
        count: 500
      },
      removeOnFail: {
        count: 1000
      }
    },
    prefix: WORKER_QUEUE_PREFIX
  };
}

function getRedisConnectionOptions(): RedisOptions {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: "shopify-ai-blog-worker",
    db: getRedisDb()
  };
}

function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

function getRedisDb(): number | undefined {
  if (!process.env.REDIS_DB) return undefined;

  const db = Number(process.env.REDIS_DB);
  return Number.isInteger(db) && db >= 0 ? db : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
