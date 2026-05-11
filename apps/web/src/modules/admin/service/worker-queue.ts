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
const BLOG_GENERATION_JOB = "blog.generate";
const ARTICLE_PUBLISH_JOB = "article.publish";

type BlogGenerationJobName = typeof BLOG_GENERATION_JOB | typeof ARTICLE_PUBLISH_JOB;

export interface QueueablePublishJob {
  id: string;
  organizationId: string;
  storeId: string;
  articleId?: string | null;
  type: "generate_article" | "publish_article";
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

type BlogGenerationQueueData = BlogGenerationJobData | ArticlePublishJobData;
type BlogGenerationQueue = Queue<BlogGenerationQueueData, unknown, BlogGenerationJobName>;

export interface EnqueuedWorkerJob {
  queue: typeof BLOG_GENERATION_QUEUE;
  jobName: BlogGenerationJobName;
  bullJobId?: string;
  externalJobId: string;
}

const globalForQueues = globalThis as typeof globalThis & {
  adminRedisConnection?: IORedis;
  adminBlogGenerationQueue?: BlogGenerationQueue;
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
    generationConfig: generationConfigValue(payload.generationConfig)
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

async function addJob(
  jobName: BlogGenerationJobName,
  data: BlogGenerationQueueData,
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

function buildJobOptions(job: QueueablePublishJob): JobsOptions {
  const delay = Math.max(0, job.runAt.getTime() - Date.now());
  return {
    jobId: job.id,
    delay
  };
}

function getBlogGenerationQueue(): BlogGenerationQueue {
  if (!globalForQueues.adminBlogGenerationQueue) {
    globalForQueues.adminBlogGenerationQueue = new Queue<BlogGenerationQueueData, unknown, BlogGenerationJobName>(
      BLOG_GENERATION_QUEUE,
      getQueueOptions()
    );
  }

  return globalForQueues.adminBlogGenerationQueue;
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
