import type { Job } from "bullmq";
import { maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import { runContentPipeline, type ContentSourceContext } from "@shopify-ai-blog/content-engine";
import {
  articleCreate,
  articleUpdate,
  createShopifyGraphQLClient,
  type ShopifyArticle
} from "@shopify-ai-blog/shopify";
import {
  BLOG_GENERATION_JOB_NAMES,
  QUEUE_NAMES,
  type ArticlePublishJobData,
  type BlogGenerationJobName,
  type BlogGenerationJobData,
  type BlogGenerationQueueJobData,
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

  const publishJob = await startPublishJob({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    type: "generate_article",
    externalJobId: externalJobId(
      QUEUE_NAMES.blogGeneration,
      BLOG_GENERATION_JOB_NAMES.blogGeneration,
      job
    ),
    articleId: job.data.articleId,
    payload: {
      campaignId: job.data.campaignId,
      sourceType: job.data.sourceType,
      sourceId: job.data.sourceId,
      topic: job.data.topic,
      locale: job.data.locale
    }
  });

  await writePublishLog({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    jobId: publishJob.id,
    articleId: job.data.articleId,
    event: "started",
    message: "Blog article generation started.",
    payload: { bullJobId: job.id, campaignId: job.data.campaignId }
  });

  try {
    const context = await loadGenerationContext(job.data);
    const input = mergeGenerationInput(job.data, context.campaign);
    const pipelineResult = await runContentPipeline(input, context.sourceContext);
    const generated = pipelineResult.article;
    const status = generated.qualityPassed ? "ready_to_publish" : "quality_failed";
    const article = await upsertGeneratedArticle({
      articleId: job.data.articleId,
      campaignId: context.campaign?.id ?? job.data.campaignId,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      publishPolicy: input.publishPolicy,
      generated,
      status,
      qualityReport: pipelineResult.artifacts.quality,
      generationMetadata: {
        generator: "content-engine:default-deterministic",
        aiProviderConfigId: context.aiProvider?.id,
        note: "No worker-safe external AI generation helper is currently exposed; generated through content-engine contracts.",
        artifacts: pipelineResult.artifacts
      }
    });

    await completePublishJob(publishJob.id, {
      articleId: article.id,
      status,
      seoScore: generated.seoScore,
      qualityPassed: generated.qualityPassed
    });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      jobId: publishJob.id,
      articleId: article.id,
      event: generated.qualityPassed ? "succeeded" : "skipped",
      level: generated.qualityPassed ? "info" : "warn",
      message: generated.qualityPassed
        ? "Blog article generation completed."
        : "Blog article generated but did not pass the quality gate.",
      payload: {
        status,
        seoScore: generated.seoScore,
        quality: pipelineResult.artifacts.quality
      }
    });
    await writeAuditLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      action: "generate",
      entityType: "BlogArticle",
      entityId: article.id,
      userId: job.data.requestedByUserId,
      metadata: {
        campaignId: context.campaign?.id ?? job.data.campaignId,
        status,
        deterministic: true
      }
    });
    await job.updateProgress({
      step: "article:generated",
      articleId: article.id,
      status,
      qualityPassed: generated.qualityPassed
    });

    return {
      ok: true,
      queue: QUEUE_NAMES.blogGeneration,
      jobName: BLOG_GENERATION_JOB_NAMES.blogGeneration,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      message: "Blog generation completed.",
      processedAt: new Date().toISOString(),
      counts: {
        articles: 1
      },
      articleId: article.id
    };
  } catch (error) {
    const message = errorMessage(error);
    await markArticleFailed(job.data.articleId, message);
    await failPublishJob(publishJob.id, message, { bullJobId: job.id });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      jobId: publishJob.id,
      articleId: job.data.articleId,
      event: "failed",
      level: "error",
      message: "Blog article generation failed.",
      payload: { error: message }
    });
    throw error;
  }
}

function throwUnsupportedBlogGenerationJob(jobName: never): never {
  throw new Error(`Unsupported blog generation job: ${String(jobName)}`);
}

async function publishArticle(
  job: Job<ArticlePublishJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.articlePublish>
): Promise<WorkerJobResult> {
  await job.updateProgress({ step: "article:publishing", articleId: job.data.articleId });
  await job.log(`Publishing article ${job.data.articleId} for store ${job.data.storeId}`);

  const publishJob = await startPublishJob({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    type: "publish_article",
    externalJobId: externalJobId(
      QUEUE_NAMES.blogGeneration,
      BLOG_GENERATION_JOB_NAMES.articlePublish,
      job
    ),
    articleId: job.data.articleId,
    payload: {
      publishPolicy: job.data.publishPolicy,
      shopifyBlogId: job.data.shopifyBlogId,
      publishAt: job.data.publishAt
    }
  });

  await writePublishLog({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    jobId: publishJob.id,
    articleId: job.data.articleId,
    event: "started",
    message: "Article publish started.",
    payload: { bullJobId: job.id }
  });

  const article = await prisma.blogArticle.findFirst({
    where: {
      id: job.data.articleId,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId
    },
    include: {
      store: true
    }
  });

  if (!article) {
    return failPublishGracefully(job, publishJob.id, `Article ${job.data.articleId} was not found.`);
  }

  await prisma.blogArticle.update({
    where: { id: article.id },
    data: { status: "publishing", failureReason: null }
  });

  const shopifyBlogId = job.data.shopifyBlogId ?? article.shopifyBlogId;
  const accessToken = maybeDecryptSecret(article.store.adminAccessTokenEncrypted);
  if (!accessToken || !shopifyBlogId) {
    const reason = !accessToken
      ? "Store does not have an admin access token."
      : "Article does not have a Shopify blog id.";
    return failPublishGracefully(job, publishJob.id, reason, article.id);
  }

  try {
    const client = createShopifyGraphQLClient({
      shopDomain: article.store.myshopifyDomain,
      accessToken,
      apiVersion: article.store.apiVersion
    });
    const published = await publishToShopify(client, article, shopifyBlogId, job.data.publishAt);
    const publishedAt = new Date();

    await prisma.blogArticle.update({
      where: { id: article.id },
      data: {
        status: "published",
        shopifyBlogId,
        shopifyArticleId: published.id,
        handle: published.handle ?? article.handle,
        title: published.title ?? article.title,
        publishedAt,
        failureReason: null
      }
    });
    await completePublishJob(publishJob.id, {
      articleId: article.id,
      shopifyArticleId: published.id,
      shopifyBlogId
    });
    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      jobId: publishJob.id,
      articleId: article.id,
      event: "succeeded",
      message: "Article published to Shopify.",
      payload: {
        shopifyArticleId: published.id,
        shopifyBlogId,
        handle: published.handle
      }
    });
    await writeAuditLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      action: "publish",
      entityType: "BlogArticle",
      entityId: article.id,
      userId: job.data.requestedByUserId,
      metadata: {
        shopifyArticleId: published.id,
        shopifyBlogId
      }
    });
    await job.updateProgress({ step: "article:published", articleId: article.id });

    return {
      ok: true,
      queue: QUEUE_NAMES.blogGeneration,
      jobName: BLOG_GENERATION_JOB_NAMES.articlePublish,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      message: "Article published to Shopify.",
      processedAt: new Date().toISOString(),
      counts: {
        published: 1
      },
      articleId: article.id
    };
  } catch (error) {
    return failPublishGracefully(job, publishJob.id, errorMessage(error), article.id);
  }
}

async function loadGenerationContext(data: BlogGenerationJobData) {
  const [store, campaign, article, aiProvider] = await Promise.all([
    prisma.shopifyStore.findFirst({
      where: {
        id: data.storeId,
        organizationId: data.organizationId
      }
    }),
    data.campaignId
      ? prisma.blogCampaign.findFirst({
          where: {
            id: data.campaignId,
            organizationId: data.organizationId,
            storeId: data.storeId
          },
          include: {
            brandVoice: true
          }
        })
      : Promise.resolve(null),
    data.articleId
      ? prisma.blogArticle.findFirst({
          where: {
            id: data.articleId,
            organizationId: data.organizationId,
            storeId: data.storeId
          }
        })
      : Promise.resolve(null),
    prisma.aiProviderConfig.findFirst({
      where: {
        organizationId: data.organizationId,
        enabled: true,
        OR: [{ storeId: data.storeId }, { storeId: null }]
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    })
  ]);

  if (!store) {
    throw new Error(`Store ${data.storeId} was not found for organization ${data.organizationId}.`);
  }

  const locale = campaign?.locale ?? article?.locale ?? data.locale;
  const sourceType = campaign?.sourceType ?? article?.sourceType ?? data.sourceType;
  const sourceId = campaign?.sourceId ?? article?.sourceId ?? data.sourceId;
  const [brandVoice, sourceContext] = await Promise.all([
    loadBrandVoice(data.organizationId, data.storeId, locale, campaign?.brandVoice),
    loadSourceContext(data.storeId, sourceType, sourceId)
  ]);

  return {
    store,
    campaign,
    article,
    aiProvider,
    sourceContext: {
      ...sourceContext,
      brandVoice: brandVoice
        ? {
            locale,
            audience: brandVoice.audience,
            tone: brandVoice.tone,
            bannedWords: brandVoice.bannedWords ?? [],
            examples: brandVoice.examples ?? []
          }
        : undefined,
      topic: campaign?.topic ?? article?.title ?? data.topic,
      seedKeywords: campaign?.keywords?.length ? campaign.keywords : undefined
    } satisfies ContentSourceContext
  };
}

function mergeGenerationInput(data: BlogGenerationJobData, campaign: Record<string, any> | null) {
  return {
    organizationId: data.organizationId,
    storeId: data.storeId,
    locale: campaign?.locale ?? data.locale,
    sourceType: campaign?.sourceType ?? data.sourceType,
    sourceId: campaign?.sourceId ?? data.sourceId,
    topic: campaign?.topic ?? data.topic ?? campaign?.title,
    publishPolicy: campaign?.publishPolicy ?? data.publishPolicy,
    targetWordCount: campaign?.targetWordCount ?? data.targetWordCount,
    primaryKeyword: campaign?.primaryKeyword ?? data.primaryKeyword
  };
}

async function loadBrandVoice(
  organizationId: string,
  storeId: string,
  locale: string,
  campaignBrandVoice?: Record<string, any> | null
) {
  if (campaignBrandVoice) return campaignBrandVoice;

  return prisma.brandVoice.findFirst({
    where: {
      organizationId,
      locale,
      OR: [{ storeId }, { storeId: null }]
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
  });
}

async function loadSourceContext(
  storeId: string,
  sourceType: string,
  sourceId: string | null | undefined
): Promise<ContentSourceContext> {
  if (!sourceId) return {};

  if (sourceType === "product") {
    const product = await prisma.productSnapshot.findFirst({
      where: {
        storeId,
        OR: [{ shopifyProductId: sourceId }, { id: sourceId }]
      },
      orderBy: { syncedAt: "desc" }
    });

    if (!product) return {};

    return {
      product: {
        id: product.shopifyProductId,
        title: product.title,
        handle: product.handle,
        description: product.descriptionHtml,
        productType: product.productType,
        vendor: product.vendor,
        tags: product.tags ?? [],
        imageUrls: product.imageUrls ?? [],
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription
      }
    };
  }

  if (sourceType === "collection") {
    const collection = await prisma.collectionSnapshot.findFirst({
      where: {
        storeId,
        OR: [{ shopifyCollectionId: sourceId }, { id: sourceId }]
      },
      orderBy: { syncedAt: "desc" }
    });

    if (!collection) return {};

    return {
      collection: {
        id: collection.shopifyCollectionId,
        title: collection.title,
        handle: collection.handle,
        description: collection.descriptionHtml,
        imageUrls: collection.imageUrl ? [collection.imageUrl] : []
      }
    };
  }

  return {};
}

async function upsertGeneratedArticle(input: {
  articleId?: string;
  campaignId?: string;
  organizationId: string;
  storeId: string;
  sourceType: string;
  sourceId?: string;
  publishPolicy: string;
  generated: {
    title: string;
    handle: string;
    summary: string;
    bodyHtml: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    tags: string[];
    locale: string;
    seoScore: number;
    qualityPassed: boolean;
  };
  status: "ready_to_publish" | "quality_failed";
  qualityReport: unknown;
  generationMetadata: unknown;
}) {
  const data = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    campaignId: input.campaignId,
    locale: input.generated.locale,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    status: input.status,
    publishPolicy: input.publishPolicy,
    title: input.generated.title,
    handle: input.generated.handle,
    summary: input.generated.summary,
    bodyHtml: input.generated.bodyHtml,
    primaryKeyword: input.generated.primaryKeyword,
    secondaryKeywords: input.generated.secondaryKeywords,
    tags: input.generated.tags,
    seoTitle: input.generated.title,
    seoDescription: input.generated.summary,
    seoScore: input.generated.seoScore,
    qualityPassed: input.generated.qualityPassed,
    qualityReport: input.qualityReport,
    generationMetadata: input.generationMetadata,
    lastGeneratedAt: new Date(),
    failureReason: input.generated.qualityPassed ? null : "Generated content did not pass the quality gate."
  };

  if (input.articleId) {
    return prisma.blogArticle.update({
      where: { id: input.articleId },
      data
    });
  }

  return prisma.blogArticle.upsert({
    where: {
      storeId_locale_handle: {
        storeId: input.storeId,
        locale: input.generated.locale,
        handle: input.generated.handle
      }
    },
    update: data,
    create: data
  });
}

async function markArticleFailed(articleId: string | undefined, failureReason: string) {
  if (!articleId) return;

  await prisma.blogArticle.update({
    where: { id: articleId },
    data: {
      status: "failed",
      failureReason
    }
  });
}

async function publishToShopify(
  client: ReturnType<typeof createShopifyGraphQLClient>,
  article: Record<string, any>,
  shopifyBlogId: string,
  publishAt: string | undefined
): Promise<ShopifyArticle> {
  const input = {
    blogId: shopifyBlogId,
    title: article.title ?? "Untitled article",
    handle: article.handle,
    bodyHtml: article.bodyHtml ?? "",
    summary: article.summary ?? undefined,
    isPublished: true,
    publishDate: publishAt,
    tags: article.tags ?? []
  };

  if (article.shopifyArticleId) {
    return articleUpdate(client, article.shopifyArticleId, input);
  }

  return articleCreate(client, input);
}

async function failPublishGracefully(
  job: Job<ArticlePublishJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.articlePublish>,
  publishJobId: string,
  reason: string,
  articleId = job.data.articleId
): Promise<WorkerJobResult> {
  await prisma.blogArticle
    .update({
      where: { id: articleId },
      data: {
        status: "failed",
        failureReason: reason
      }
    })
    .catch(() => undefined);
  await failPublishJob(publishJobId, reason, { articleId, bullJobId: job.id });
  await writePublishLog({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    jobId: publishJobId,
    articleId,
    event: "failed",
    level: "error",
    message: "Article publish failed.",
    payload: { error: reason }
  });
  await job.updateProgress({ step: "article:publish_failed", articleId, reason });

  return {
    ok: false,
    queue: QUEUE_NAMES.blogGeneration,
    jobName: BLOG_GENERATION_JOB_NAMES.articlePublish,
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    message: reason,
    processedAt: new Date().toISOString(),
    counts: {
      published: 0
    },
    articleId
  };
}
