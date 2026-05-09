import type { Job } from "bullmq";
import { createOpenAICompatibleClient, type GenerateTextResult } from "@shopify-ai-blog/ai";
import { maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import { runContentPipeline, type ContentSourceContext } from "@shopify-ai-blog/content-engine";
import {
  blogCampaignInputSchema,
  generatedArticleSchema,
  normalizeLocale,
  type GeneratedArticle,
  type PublishPolicy,
  type SourceType,
  type SupportedLocale
} from "@shopify-ai-blog/shared";
import {
  articleCreate,
  articleUpdate,
  createShopifyGraphQLClient,
  type ShopifyGraphQLClient,
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
import {
  domainError,
  failureJobStatus,
  failurePayload,
  failurePublishEvent,
  getErrorMessage,
  throwForBullMQ,
  toPrismaJson,
  trimForDb,
  willRetryJob
} from "./shared";
import { resolveFreshStoreAccessToken } from "./shopify-token";

export type BlogGenerationJob = Job<
  BlogGenerationQueueJobData,
  WorkerJobResult,
  BlogGenerationJobName
>;

interface AiProviderRecord {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKeyEncrypted: string | null;
  textModel: string;
  imageModel: string | null;
  temperature: number;
}

interface ResolvedAiProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  textModel: string;
  temperature: number;
  safeMetadata: {
    id: string;
    name: string;
    provider: string;
    baseUrl: string;
    textModel: string;
    imageModelConfigured: boolean;
  };
}

interface GenerationCampaignInput {
  locale: string;
  sourceType: SourceType;
  sourceId: string | null;
  topic: string | null;
  title: string;
  publishPolicy: PublishPolicy;
  targetWordCount: number;
  primaryKeyword: string | null;
}

interface BrandVoiceContextRow {
  audience: string | null;
  tone: string | null;
  bannedWords: string[];
  examples: string[];
}

interface PublishableArticleRow {
  title: string | null;
  handle: string | null;
  bodyHtml: string | null;
  summary: string | null;
  tags: string[];
  shopifyArticleId: string | null;
}

interface ParsedGenerationInput {
  organizationId: string;
  storeId: string;
  locale: SupportedLocale;
  sourceType: SourceType;
  sourceId?: string;
  topic?: string;
  publishPolicy: PublishPolicy;
  targetWordCount: number;
  primaryKeyword?: string;
}

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

  let publishJob: Awaited<ReturnType<typeof startPublishJob>> | undefined;
  let articleId = job.data.articleId;

  try {
    const context = await loadGenerationContext(job.data);
    const input = mergeGenerationInput(job.data, context.campaign);
    const parsedInput = blogCampaignInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw domainError("BLOG_GENERATION_INPUT_INVALID", "Blog generation input is invalid.", {
        details: parsedInput.error.flatten()
      });
    }
    const generationInput = parsedInput.data;

    publishJob = await startPublishJob({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      type: "generate_article",
      externalJobId: externalJobId(
        QUEUE_NAMES.blogGeneration,
        BLOG_GENERATION_JOB_NAMES.blogGeneration,
        job
      ),
      articleId: context.article?.id,
      payload: {
        campaignId: job.data.campaignId,
        sourceType: parsedInput.data.sourceType,
        sourceId: parsedInput.data.sourceId,
        topic: parsedInput.data.topic,
        locale: parsedInput.data.locale
      }
    });

    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      jobId: publishJob.id,
      articleId,
      event: "started",
      message: "Blog article generation started.",
      payload: { bullJobId: job.id, campaignId: job.data.campaignId }
    });

    await markCampaignRunning(context.campaign?.id);
    const pipelineResult = await runContentPipeline(generationInput, context.sourceContext);
    const aiProvider = resolveAiProvider(context.aiProvider);
    const aiResult = await generateArticleWithAi(aiProvider, generationInput, context.sourceContext, pipelineResult);
    const generated = aiResult.article;
    const status = generated.qualityPassed ? "ready_to_publish" : "quality_failed";
    const article = await upsertGeneratedArticle({
      articleId: job.data.articleId,
      campaignId: context.campaign?.id ?? job.data.campaignId,
      organizationId: job.data.organizationId,
      storeId: job.data.storeId,
      sourceType: generationInput.sourceType,
      sourceId: generationInput.sourceId,
      publishPolicy: generationInput.publishPolicy,
      generated,
      status,
      qualityReport: pipelineResult.artifacts.quality,
      generationMetadata: {
        generator: "openai-compatible",
        provider: aiProvider.safeMetadata,
        ai: aiResult.metadata,
        contentEngine: {
          artifacts: pipelineResult.artifacts
        },
        queue: {
          bullJobId: job.id,
          correlationId: job.data.correlationId
        }
      }
    });
    articleId = article.id;

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
        aiProviderConfigId: context.aiProvider?.id,
        aiModel: aiResult.metadata.model
      }
    });
    await markCampaignCompleted(context.campaign?.id, generated.qualityPassed);
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
    await recordGenerationFailure(job, error, publishJob?.id, articleId);
    throwForBullMQ(error);
  }
}

function throwUnsupportedBlogGenerationJob(jobName: never): never {
  throw new Error(`Unsupported blog generation job: ${String(jobName)}`);
}

async function markCampaignRunning(campaignId: string | undefined): Promise<void> {
  if (!campaignId) return;

  await prisma.blogCampaign.update({
    where: { id: campaignId },
    data: {
      status: "active",
      startedAt: new Date()
    }
  });
}

async function markCampaignCompleted(campaignId: string | undefined, qualityPassed: boolean): Promise<void> {
  if (!campaignId) return;

  const articles = await prisma.blogArticle.findMany({
    where: { campaignId },
    select: { status: true }
  });
  const hasOpenArticles = articles.some((article: { status: string }) =>
    ["draft", "publishing", "failed"].includes(article.status)
  );

  await prisma.blogCampaign.update({
    where: { id: campaignId },
    data: {
      status: qualityPassed && !hasOpenArticles ? "completed" : "active",
      completedAt: qualityPassed && !hasOpenArticles ? new Date() : undefined
    }
  });
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function resolveAiProvider(provider: AiProviderRecord | null): ResolvedAiProvider {
  if (!provider) {
    throw domainError(
      "AI_PROVIDER_MISSING",
      "No enabled AI provider is configured for this organization or store.",
      { retryable: false }
    );
  }

  let apiKey: string | null | undefined;
  try {
    apiKey = maybeDecryptSecret(provider.apiKeyEncrypted);
  } catch (error) {
    throw domainError(
      "AI_PROVIDER_KEY_DECRYPT_FAILED",
      `Could not decrypt AI provider key: ${getErrorMessage(error)}`,
      { retryable: false }
    );
  }

  if (!provider.baseUrl || !provider.textModel || !apiKey) {
    throw domainError(
      "AI_PROVIDER_INCOMPLETE",
      "AI provider requires baseUrl, textModel, and an encrypted API key before article generation can run.",
      {
        retryable: false,
        details: {
          providerId: provider.id,
          hasBaseUrl: Boolean(provider.baseUrl),
          hasTextModel: Boolean(provider.textModel),
          hasApiKey: Boolean(apiKey)
        }
      }
    );
  }

  return {
    id: provider.id,
    baseUrl: provider.baseUrl,
    apiKey,
    textModel: provider.textModel,
    temperature: provider.temperature,
    safeMetadata: {
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      textModel: provider.textModel,
      imageModelConfigured: Boolean(provider.imageModel)
    }
  };
}

async function generateArticleWithAi(
  provider: ResolvedAiProvider,
  input: ParsedGenerationInput,
  context: ContentSourceContext,
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>
): Promise<{
  article: GeneratedArticle;
  metadata: {
    id?: string;
    model?: string;
    finishReason?: string;
    usage?: GenerateTextResult["usage"];
  };
}> {
  const client = createOpenAICompatibleClient({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.textModel,
    timeoutMs: 120000
  });
  const result = await client.generateText({
    model: provider.textModel,
    temperature: provider.temperature,
    system: pipelineResult.artifacts.prompts.system,
    prompt: [
      "Return only a JSON object matching this shape:",
      JSON.stringify({
        title: "string",
        handle: "string",
        summary: "string",
        bodyHtml: "HTML string, at least 200 characters",
        primaryKeyword: "string",
        secondaryKeywords: ["string"],
        tags: ["string"],
        locale: input.locale,
        seoScore: 0,
        qualityPassed: true,
        imagePrompt: "optional string",
        imageAlt: "optional string"
      }),
      "Use this content-engine draft as the approved strategy and structure:",
      JSON.stringify(pipelineResult.article),
      "Use these prompts and source context:",
      JSON.stringify({
        outlinePrompt: pipelineResult.artifacts.prompts.outlinePrompt,
        draftPrompt: pipelineResult.artifacts.prompts.draftPrompt,
        sourceContext: context
      })
    ].join("\n\n"),
    maxTokens: Math.max(1800, Math.min(5000, input.targetWordCount * 3)),
    responseFormat: { type: "json_object" }
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(result.content));
  } catch (error) {
    throw domainError("AI_RESPONSE_INVALID_JSON", "AI provider returned non-JSON article output.", {
      retryable: true,
      details: {
        error: getErrorMessage(error),
        responsePreview: trimForDb(result.content, 800)
      }
    });
  }

  const article = generatedArticleSchema.safeParse(parsed);
  if (!article.success) {
    throw domainError("AI_ARTICLE_SCHEMA_INVALID", "AI provider returned an article that failed schema validation.", {
      retryable: true,
      details: article.error.flatten()
    });
  }

  return {
    article: article.data,
    metadata: {
      id: result.id,
      model: result.model ?? provider.textModel,
      finishReason: result.finishReason,
      usage: result.usage
    }
  };
}

async function publishArticle(
  job: Job<ArticlePublishJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.articlePublish>
): Promise<WorkerJobResult> {
  await job.updateProgress({ step: "article:publishing", articleId: job.data.articleId });
  await job.log(`Publishing article ${job.data.articleId} for store ${job.data.storeId}`);

  let publishJob: Awaited<ReturnType<typeof startPublishJob>> | undefined;
  let articleId = job.data.articleId;

  try {
    const store = await loadStoreForJob(job.data.organizationId, job.data.storeId);
    publishJob = await startPublishJob({
      organizationId: job.data.organizationId,
      storeId: store.id,
      type: "publish_article",
      externalJobId: externalJobId(
        QUEUE_NAMES.blogGeneration,
        BLOG_GENERATION_JOB_NAMES.articlePublish,
        job
      ),
      payload: {
        articleId: job.data.articleId,
        publishPolicy: job.data.publishPolicy,
        shopifyBlogId: job.data.shopifyBlogId,
        publishAt: job.data.publishAt
      }
    });

    await writePublishLog({
      organizationId: job.data.organizationId,
      storeId: store.id,
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
        storeId: store.id
      }
    });

    if (!article) {
      throw domainError(
        "ARTICLE_NOT_FOUND",
        `Article ${job.data.articleId} was not found for store ${store.id}.`
      );
    }

    articleId = article.id;
    await prisma.publishJob.update({
      where: { id: publishJob.id },
      data: { articleId: article.id }
    });
    await prisma.blogArticle.update({
      where: { id: article.id },
      data: { status: "publishing", failureReason: null }
    });

    const shopifyBlogId = await resolveShopifyBlogId(job.data, article);
    const accessToken = await resolveFreshStoreAccessToken(store, "publish");
    validatePublishInputs(article, shopifyBlogId);

    const client = createShopifyGraphQLClient({
      shopDomain: store.myshopifyDomain,
      accessToken,
      apiVersion: store.apiVersion
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
        canonicalUrl: buildCanonicalUrl(store.myshopifyDomain, published),
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
    await recordPublishFailure(job, error, publishJob?.id, articleId);
    throwForBullMQ(error);
  }
}

async function loadStoreForJob(organizationId: string, storeId: string) {
  const store = await prisma.shopifyStore.findFirst({
    where: {
      id: storeId,
      organizationId
    }
  });

  if (!store) {
    throw domainError("STORE_NOT_FOUND", `Store ${storeId} was not found for organization ${organizationId}.`, {
      retryable: false
    });
  }

  if (store.status !== "active") {
    throw domainError(
      "STORE_NOT_ACTIVE",
      `Store ${store.myshopifyDomain} is ${store.status}; reconnect or activate Shopify before publishing.`,
      { retryable: false }
    );
  }

  return store;
}

async function resolveShopifyBlogId(
  data: ArticlePublishJobData,
  article: {
    organizationId: string;
    storeId: string;
    locale: string;
    shopifyBlogId: string | null;
  }
): Promise<string> {
  if (data.shopifyBlogId) return data.shopifyBlogId;
  if (article.shopifyBlogId) return article.shopifyBlogId;

  const locale = normalizeLocale(data.locale ?? article.locale);
  const localeConfig = await prisma.localeConfig.findFirst({
    where: {
      organizationId: article.organizationId,
      storeId: article.storeId,
      locale,
      isEnabled: true
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
  });

  if (!localeConfig?.shopifyBlogId) {
    throw domainError(
      "SHOPIFY_BLOG_ID_MISSING",
      `No Shopify blog id is configured for ${locale}. Configure the language blog mapping before publishing.`,
      { retryable: false }
    );
  }

  return localeConfig.shopifyBlogId;
}

function validatePublishInputs(
  article: {
    title: string | null;
    bodyHtml: string | null;
    status: string;
  },
  shopifyBlogId: string
): void {
  if (!shopifyBlogId) {
    throw domainError("SHOPIFY_BLOG_ID_MISSING", "Shopify blog id is required before publishing.", {
      retryable: false
    });
  }

  if (!article.title || !article.bodyHtml) {
    throw domainError("ARTICLE_CONTENT_INCOMPLETE", "Article requires a title and bodyHtml before publishing.", {
      retryable: false
    });
  }

  if (!["ready_to_publish", "published", "publishing"].includes(article.status)) {
    throw domainError(
      "ARTICLE_NOT_READY",
      `Article is ${article.status}; only ready_to_publish articles can be published.`,
      { retryable: false }
    );
  }
}

function buildCanonicalUrl(shopDomain: string, article: ShopifyArticle): string | null {
  const blogHandle = article.blog?.handle;
  if (!blogHandle || !article.handle) return null;
  return `https://${shopDomain}/blogs/${blogHandle}/${article.handle}`;
}

async function recordGenerationFailure(
  job: Job<BlogGenerationJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.blogGeneration>,
  error: unknown,
  publishJobId?: string,
  articleId?: string
): Promise<void> {
  const message = errorMessage(error);
  const retrying = willRetryJob(job, error);

  await job.updateProgress({
    step: retrying ? "article:generation_retry_scheduled" : "article:generation_failed",
    error: message
  });
  await job.log(`${job.name} failed: ${message}`);
  await markArticleFailed(articleId, message);

  if (job.data.campaignId) {
    await prisma.blogCampaign.update({
      where: { id: job.data.campaignId },
      data: {
        status: retrying ? "active" : "failed",
        metadata: toPrismaJson({
          lastFailure: failurePayload(error),
          bullJobId: job.id,
          attempt: job.attemptsMade + 1
        })
      }
    });
  }

  if (publishJobId) {
    await failPublishJob(
      publishJobId,
      message,
      {
        bullJobId: job.id,
        articleId,
        campaignId: job.data.campaignId,
        error: failurePayload(error),
        attempt: job.attemptsMade + 1
      },
      failureJobStatus(job, error)
    );
  }

  await writePublishLog({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    jobId: publishJobId,
    articleId,
    event: failurePublishEvent(job, error),
    level: retrying ? "warn" : "error",
    message: "Blog article generation failed.",
    payload: {
      error: failurePayload(error),
      campaignId: job.data.campaignId,
      attempt: job.attemptsMade + 1,
      willRetry: retrying
    }
  });
  await writeAuditLog({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    action: "generate",
    entityType: "BlogArticle",
    entityId: articleId ?? job.data.articleId ?? job.data.campaignId,
    userId: job.data.requestedByUserId,
    metadata: {
      event: retrying ? "retry_scheduled" : "failed",
      error: failurePayload(error),
      bullJobId: job.id,
      campaignId: job.data.campaignId,
      correlationId: job.data.correlationId
    }
  });
}

async function recordPublishFailure(
  job: Job<ArticlePublishJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.articlePublish>,
  error: unknown,
  publishJobId?: string,
  articleId = job.data.articleId
): Promise<void> {
  const message = errorMessage(error);
  const retrying = willRetryJob(job, error);

  await job.updateProgress({
    step: retrying ? "article:publish_retry_scheduled" : "article:publish_failed",
    articleId,
    error: message
  });
  await job.log(`${job.name} failed: ${message}`);

  await prisma.blogArticle
    .update({
      where: { id: articleId },
      data: {
        status: retrying ? "publishing" : "failed",
        failureReason: message
      }
    })
    .catch(() => undefined);

  if (publishJobId) {
    await failPublishJob(
      publishJobId,
      message,
      {
        bullJobId: job.id,
        articleId,
        error: failurePayload(error),
        attempt: job.attemptsMade + 1
      },
      failureJobStatus(job, error)
    );
  }

  await writePublishLog({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    jobId: publishJobId,
    articleId,
    event: failurePublishEvent(job, error),
    level: retrying ? "warn" : "error",
    message: "Article publish failed.",
    payload: {
      error: failurePayload(error),
      attempt: job.attemptsMade + 1,
      willRetry: retrying
    }
  });
  await writeAuditLog({
    organizationId: job.data.organizationId,
    storeId: job.data.storeId,
    action: "publish",
    entityType: "BlogArticle",
    entityId: articleId,
    userId: job.data.requestedByUserId,
    metadata: {
      event: retrying ? "retry_scheduled" : "failed",
      error: failurePayload(error),
      bullJobId: job.id,
      correlationId: job.data.correlationId
    }
  });
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

  const locale = normalizeLocale(campaign?.locale ?? article?.locale ?? data.locale);
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
            audience: brandVoice.audience ?? undefined,
            tone: brandVoice.tone ?? undefined,
            bannedWords: brandVoice.bannedWords ?? [],
            examples: brandVoice.examples ?? []
          }
        : undefined,
      topic: campaign?.topic ?? article?.title ?? data.topic,
      seedKeywords: campaign?.keywords?.length ? campaign.keywords : undefined
    } satisfies ContentSourceContext
  };
}

function mergeGenerationInput(data: BlogGenerationJobData, campaign: GenerationCampaignInput | null) {
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
  campaignBrandVoice?: BrandVoiceContextRow | null
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
        description: product.descriptionHtml ?? undefined,
        productType: product.productType ?? undefined,
        vendor: product.vendor ?? undefined,
        tags: product.tags ?? [],
        imageUrls: product.imageUrls ?? [],
        seoTitle: product.seoTitle ?? undefined,
        seoDescription: product.seoDescription ?? undefined
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
        description: collection.descriptionHtml ?? undefined,
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
  sourceType: SourceType;
  sourceId?: string;
  publishPolicy: PublishPolicy;
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
    qualityReport: toPrismaJson(input.qualityReport),
    generationMetadata: toPrismaJson(input.generationMetadata),
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

  await prisma.blogArticle
    .update({
      where: { id: articleId },
      data: {
        status: "failed",
        failureReason
      }
    })
    .catch(() => undefined);
}

async function publishToShopify(
  client: ShopifyGraphQLClient,
  article: PublishableArticleRow,
  shopifyBlogId: string,
  publishAt: string | undefined
): Promise<ShopifyArticle> {
  const input = {
    blogId: shopifyBlogId,
    title: article.title ?? "Untitled article",
    handle: article.handle ?? undefined,
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
