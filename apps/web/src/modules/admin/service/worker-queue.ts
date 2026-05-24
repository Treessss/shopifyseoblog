import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import {
  generationConfigSchema,
  normalizeLocale,
  type BlogCampaignInput,
  type GenerationConfig,
  type PublishPolicy,
  type SupportedLocale
} from "@shopify-ai-blog/shared";

const WORKER_QUEUE_PREFIX = process.env.BULLMQ_PREFIX ?? "shopify-ai-blog-local";
const BLOG_GENERATION_QUEUE = "blog-generation";
const SEO_PERFORMANCE_QUEUE = "seo-performance";
const BLOG_GENERATION_JOB = "blog.generate";
const ARTICLE_PUBLISH_JOB = "article.publish";
const SEARCH_CONSOLE_STORE_SYNC_JOB = "gsc.store.sync";
const SEARCH_CONSOLE_ARTICLE_SYNC_JOB = "gsc.article.sync";

type BlogGenerationJobName = typeof BLOG_GENERATION_JOB | typeof ARTICLE_PUBLISH_JOB;
type SearchConsoleJobName = typeof SEARCH_CONSOLE_STORE_SYNC_JOB | typeof SEARCH_CONSOLE_ARTICLE_SYNC_JOB;

export interface QueueablePublishJob {
  id: string;
  organizationId: string;
  storeId: string;
  articleId?: string | null;
  type: "generate_article" | "publish_article" | "sync_search_console";
  runAt: Date;
  payload: unknown;
}

export interface EnqueueContext {
  requestedByUserId?: string;
}

interface BlogGenerationJobData extends BlogCampaignInput {
  campaignId?: string;
  articleId?: string;
  publishJobId?: string;
  requestedByUserId?: string;
  generationMode?: "new_article" | "article_repair";
  repairReason?: string;
  publishAfterRepair?: boolean;
  publishAt?: string;
}

interface ArticlePublishJobData {
  organizationId: string;
  storeId: string;
  publishJobId?: string;
  requestedByUserId?: string;
  articleId: string;
  locale?: SupportedLocale;
  publishPolicy?: PublishPolicy;
  shopifyBlogId?: string;
  publishAt?: string;
}

interface SearchConsoleStoreSyncJobData {
  organizationId: string;
  storeId: string;
  publishJobId?: string;
  requestedByUserId?: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  dataState?: "final" | "all";
  rowLimit?: number;
}

interface SearchConsoleArticleSyncJobData {
  organizationId: string;
  storeId: string;
  publishJobId?: string;
  requestedByUserId?: string;
  articleId: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  dataState?: "final" | "all";
  rowLimit?: number;
}

type BlogGenerationQueue = Queue<BlogGenerationJobData | ArticlePublishJobData, unknown, BlogGenerationJobName>;
type SearchConsoleQueue = Queue<SearchConsoleStoreSyncJobData | SearchConsoleArticleSyncJobData, unknown, SearchConsoleJobName>;

export interface EnqueuedWorkerJob {
  queue: typeof BLOG_GENERATION_QUEUE | typeof SEO_PERFORMANCE_QUEUE;
  jobName: BlogGenerationJobName | SearchConsoleJobName;
  bullJobId?: string;
  externalJobId: string;
}

const globalForQueues = globalThis as typeof globalThis & {
  adminRedisConnection?: IORedis;
  adminBlogGenerationQueue?: BlogGenerationQueue;
  adminSearchConsoleQueue?: SearchConsoleQueue;
};

export async function enqueuePublishJobForWorker(
  job: QueueablePublishJob,
  context: EnqueueContext
): Promise<EnqueuedWorkerJob> {
  switch (job.type) {
    case "generate_article":
      return enqueueBlogGeneration(job, context);
    case "publish_article":
      return enqueueArticlePublish(job, context);
    case "sync_search_console":
      return enqueueSearchConsole(job, context);
    default:
      throw new Error("Unsupported worker job type.");
  }
}

async function enqueueBlogGeneration(
  job: QueueablePublishJob,
  context: EnqueueContext
): Promise<EnqueuedWorkerJob> {
  const payload = asRecord(job.payload);
  const data: BlogGenerationJobData = {
    organizationId: stringValue(payload.organizationId) ?? job.organizationId,
    storeId: stringValue(payload.storeId) ?? job.storeId,
    campaignId: stringValue(payload.campaignId),
    articleId: stringValue(payload.articleId),
    publishJobId: job.id,
    requestedByUserId: context.requestedByUserId,
    locale: normalizeLocale(stringValue(payload.locale)),
    sourceType: sourceTypeValue(payload.sourceType),
    sourceId: stringValue(payload.sourceId),
    topic: stringValue(payload.topic),
    publishPolicy: publishPolicyValue(payload.publishPolicy),
    targetWordCount: numberValue(payload.targetWordCount) ?? 1400,
    primaryKeyword: stringValue(payload.primaryKeyword),
    generationConfig: generationConfigValue(payload.generationConfig),
    generationMode: generationModeValue(payload.generationMode),
    repairReason: stringValue(payload.repairReason),
    publishAfterRepair: booleanValue(payload.publishAfterRepair),
    publishAt: stringValue(payload.publishAt)
  };

  return addJob(BLOG_GENERATION_JOB, data, job);
}

async function enqueueArticlePublish(
  job: QueueablePublishJob,
  context: EnqueueContext
): Promise<EnqueuedWorkerJob> {
  const payload = asRecord(job.payload);
  const articleId = stringValue(payload.articleId) ?? job.articleId;
  if (!articleId) {
    throw new Error(`Queued publish job ${job.id} is missing articleId.`);
  }

  const data: ArticlePublishJobData = {
    organizationId: stringValue(payload.organizationId) ?? job.organizationId,
    storeId: stringValue(payload.storeId) ?? job.storeId,
    publishJobId: job.id,
    requestedByUserId: context.requestedByUserId,
    articleId,
    locale: stringValue(payload.locale) ? normalizeLocale(stringValue(payload.locale)) : undefined,
    publishPolicy: publishPolicyValue(payload.publishPolicy),
    shopifyBlogId: stringValue(payload.shopifyBlogId),
    publishAt: stringValue(payload.publishAt)
  };

  return addJob(ARTICLE_PUBLISH_JOB, data, job);
}

async function enqueueSearchConsole(
  job: QueueablePublishJob,
  context: EnqueueContext
): Promise<EnqueuedWorkerJob> {
  const payload = asRecord(job.payload);
  const isArticleSync = Boolean(payload.articleId ?? job.articleId);
  const dataState = payload.dataState === "all" ? "all" : "final";
  const data: SearchConsoleStoreSyncJobData | SearchConsoleArticleSyncJobData = isArticleSync
    ? {
        organizationId: stringValue(payload.organizationId) ?? job.organizationId,
        storeId: stringValue(payload.storeId) ?? job.storeId,
        publishJobId: job.id,
        requestedByUserId: context.requestedByUserId,
        articleId: stringValue(payload.articleId) ?? job.articleId ?? "",
        propertyId: stringValue(payload.propertyId),
        startDate: stringValue(payload.startDate),
        endDate: stringValue(payload.endDate),
        days: numberValue(payload.days),
        dataState,
        rowLimit: numberValue(payload.rowLimit)
      }
    : {
        organizationId: stringValue(payload.organizationId) ?? job.organizationId,
        storeId: stringValue(payload.storeId) ?? job.storeId,
        publishJobId: job.id,
        requestedByUserId: context.requestedByUserId,
        propertyId: stringValue(payload.propertyId),
        startDate: stringValue(payload.startDate),
        endDate: stringValue(payload.endDate),
        days: numberValue(payload.days),
        dataState,
        rowLimit: numberValue(payload.rowLimit)
      };

  return addSearchConsoleJob(
    isArticleSync ? SEARCH_CONSOLE_ARTICLE_SYNC_JOB : SEARCH_CONSOLE_STORE_SYNC_JOB,
    data,
    job
  );
}

async function addJob(
  jobName: BlogGenerationJobName,
  data: BlogGenerationJobData | ArticlePublishJobData,
  job: QueueablePublishJob
): Promise<EnqueuedWorkerJob> {
  const queued = await getBlogGenerationQueue().add(jobName, data, buildJobOptions(job));
  const bullJobId = queued.id ?? job.id;

  return {
    queue: BLOG_GENERATION_QUEUE,
    jobName,
    bullJobId: queued.id,
    externalJobId: `bullmq:${BLOG_GENERATION_QUEUE}:${jobName}:${bullJobId}`
  };
}

async function addSearchConsoleJob(
  jobName: SearchConsoleJobName,
  data: SearchConsoleStoreSyncJobData | SearchConsoleArticleSyncJobData,
  job: QueueablePublishJob
): Promise<EnqueuedWorkerJob> {
  const queued = await getSearchConsoleQueue().add(jobName, data, buildJobOptions(job));
  const bullJobId = queued.id ?? job.id;

  return {
    queue: SEO_PERFORMANCE_QUEUE,
    jobName,
    bullJobId: queued.id,
    externalJobId: `bullmq:${SEO_PERFORMANCE_QUEUE}:${jobName}:${bullJobId}`
  };
}

function buildJobOptions(job: QueueablePublishJob): JobsOptions {
  const delay = Math.max(0, job.runAt.getTime() - Date.now());
  return {
    jobId: job.id,
    delay
  };
}

function getBlogGenerationQueue(): BlogGenerationQueue {
  if (!globalForQueues.adminBlogGenerationQueue) {
    globalForQueues.adminBlogGenerationQueue = new Queue<
      BlogGenerationJobData | ArticlePublishJobData,
      unknown,
      BlogGenerationJobName
    >(
      BLOG_GENERATION_QUEUE,
      getQueueOptions()
    );
  }

  return globalForQueues.adminBlogGenerationQueue;
}

function getSearchConsoleQueue(): SearchConsoleQueue {
  if (!globalForQueues.adminSearchConsoleQueue) {
    globalForQueues.adminSearchConsoleQueue = new Queue<
      SearchConsoleStoreSyncJobData | SearchConsoleArticleSyncJobData,
      unknown,
      SearchConsoleJobName
    >(SEO_PERFORMANCE_QUEUE, getQueueOptions());
  }

  return globalForQueues.adminSearchConsoleQueue;
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

function getRedisConnection(): IORedis {
  if (!globalForQueues.adminRedisConnection) {
    globalForQueues.adminRedisConnection = new IORedis(getRedisUrl(), getRedisConnectionOptions());
  }

  return globalForQueues.adminRedisConnection;
}

function getRedisConnectionOptions(): RedisOptions {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: "shopify-ai-blog-web",
    db: getRedisDb()
  };
}

function getRedisUrl() {
  return process.env.REDIS_URL ?? "redis://localhost:6381";
}

function getRedisDb(): number | undefined {
  if (!process.env.REDIS_DB) return undefined;

  const db = Number(process.env.REDIS_DB);
  return Number.isInteger(db) && db >= 0 ? db : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function sourceTypeValue(value: unknown): BlogCampaignInput["sourceType"] {
  return value === "product" || value === "collection" || value === "manual_topic" ? value : "manual_topic";
}

function publishPolicyValue(value: unknown): PublishPolicy {
  return value === "auto_when_qualified" || value === "direct" || value === "manual_review"
    ? value
    : "manual_review";
}

function generationConfigValue(value: unknown): GenerationConfig | undefined {
  const parsed = generationConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function generationModeValue(value: unknown): BlogGenerationJobData["generationMode"] {
  return value === "article_repair" || value === "new_article" ? value : undefined;
}
