import type { Job } from "bullmq";
import {
  BLOG_GENERATION_JOB_NAMES,
  QUEUE_NAMES,
  type ArticlePublishJobData,
  type BlogGenerationJobName,
  type BlogGenerationJobData,
  type BlogGenerationQueueJobData,
  type WorkerJobResult
} from "../queues";

export type BlogGenerationJob = Job<
  BlogGenerationQueueJobData,
  WorkerJobResult,
  BlogGenerationJobName
>;

export async function processBlogGenerationJob(job: BlogGenerationJob): Promise<WorkerJobResult> {
  const jobName = job.name;

  switch (jobName) {
    case BLOG_GENERATION_JOB_NAMES.blogGeneration:
      return generateBlogArticle(
        job as Job<
          BlogGenerationJobData,
          WorkerJobResult,
          typeof BLOG_GENERATION_JOB_NAMES.blogGeneration
        >
      );
    case BLOG_GENERATION_JOB_NAMES.articlePublish:
      return publishArticle(
        job as Job<
          ArticlePublishJobData,
          WorkerJobResult,
          typeof BLOG_GENERATION_JOB_NAMES.articlePublish
        >
      );
    default:
      throwUnsupportedBlogGenerationJob(jobName);
  }
}

async function generateBlogArticle(
  job: Job<BlogGenerationJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.blogGeneration>
): Promise<WorkerJobResult> {
  await job.updateProgress({ step: "article:generating", sourceType: job.data.sourceType });
  await job.log(`Generating blog article for campaign ${job.data.campaignId ?? "ad-hoc"}`);

  return {
    ok: true,
    queue: QUEUE_NAMES.blogGeneration,
    jobName: BLOG_GENERATION_JOB_NAMES.blogGeneration,
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    message: "Blog generation job accepted by worker.",
    processedAt: new Date().toISOString(),
    counts: {
      articles: 1
    },
    articleId: job.data.articleId
  };
}

function throwUnsupportedBlogGenerationJob(jobName: never): never {
  throw new Error(`Unsupported blog generation job: ${String(jobName)}`);
}

async function publishArticle(
  job: Job<ArticlePublishJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.articlePublish>
): Promise<WorkerJobResult> {
  await job.updateProgress({ step: "article:publishing", articleId: job.data.articleId });
  await job.log(`Publishing article ${job.data.articleId} for store ${job.data.storeId}`);

  return {
    ok: true,
    queue: QUEUE_NAMES.blogGeneration,
    jobName: BLOG_GENERATION_JOB_NAMES.articlePublish,
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    message: "Article publish job accepted by worker.",
    processedAt: new Date().toISOString(),
    counts: {
      published: 1
    },
    articleId: job.data.articleId
  };
}
