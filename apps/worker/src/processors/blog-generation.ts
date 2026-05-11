import type { Job } from "bullmq";
import { createOpenAICompatibleClient, type GenerateImageResult, type GenerateTextResult } from "@shopify-ai-blog/ai";
import { maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import {
  defaultQualityGate,
  defaultSeoScorer,
  discoverTrendSignals,
  runContentPipeline,
  type ContentSourceContext,
  type HtmlAssemblyResult,
  type InternalLinkCandidate,
  selectTopicCandidate,
  type TopicSelectionResult,
  type TrendSignal
} from "@shopify-ai-blog/content-engine";
import {
  blogCampaignInputSchema,
  generatedArticleSchema,
  normalizeLocale,
  type GenerationConfig,
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
  imageModel: string | null;
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
  keywords: string[];
  publishPolicy: PublishPolicy;
  targetWordCount: number;
  primaryKeyword: string | null;
  metadata: unknown;
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
  generationConfig?: GenerationConfig;
}

interface ImageAssetDraft {
  prompt: string;
  altText: string;
  publicUrl?: string;
  sourceUrl?: string;
  providerModel?: string;
  raw?: unknown;
  error?: string;
  referenceImageUrls: string[];
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
    const input = mergeGenerationInput(job.data, context.campaign, context.sourceContext.topic);
    const parsedInput = blogCampaignInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw domainError("BLOG_GENERATION_INPUT_INVALID", "Blog generation input is invalid.", {
        details: parsedInput.error.flatten()
      });
    }
    const generationInput = parsedInput.data;

    publishJob = await startPublishJob({
      jobId: job.data.publishJobId,
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
    await persistCampaignTopicSelection(context.campaign?.id, context.sourceContext.topicSelection);
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
      qualityReport: aiResult.quality,
      generationMetadata: {
        generator: "openai-compatible",
        provider: aiProvider.safeMetadata,
        ai: aiResult.metadata,
        imageAsset: aiResult.imageAsset
          ? {
              prompt: aiResult.imageAsset.prompt,
              altText: aiResult.imageAsset.altText,
              publicUrl: aiResult.imageAsset.publicUrl,
              sourceUrl: aiResult.imageAsset.sourceUrl,
              providerModel: aiResult.imageAsset.providerModel,
              error: aiResult.imageAsset.error,
              referenceImageUrls: aiResult.imageAsset.referenceImageUrls
            }
          : null,
        contentEngine: {
          artifacts: pipelineResult.artifacts,
          finalQuality: aiResult.quality,
          finalSeo: aiResult.seo
        },
        queue: {
          bullJobId: job.id,
          correlationId: job.data.correlationId
        }
      }
    });
    articleId = article.id;
    if (aiResult.imageAsset) {
      await persistGeneratedImageAsset({
        organizationId: job.data.organizationId,
        storeId: job.data.storeId,
        articleId: article.id,
        provider: context.aiProvider?.provider ?? null,
        asset: aiResult.imageAsset
      });
    }

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
        quality: aiResult.quality
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
    imageModel: provider.imageModel,
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
  seo: Awaited<ReturnType<typeof defaultSeoScorer.score>>;
  quality: Awaited<ReturnType<typeof defaultQualityGate.evaluate>>;
  imageAsset?: ImageAssetDraft;
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
      "Use this content-engine draft as source strategy, not as a title or wording template:",
      JSON.stringify(pipelineResult.article),
      "Use these prompts and source context:",
      JSON.stringify({
        outlinePrompt: pipelineResult.artifacts.prompts.outlinePrompt,
        draftPrompt: pipelineResult.artifacts.prompts.draftPrompt,
        sourceContext: context
      }),
      "Required quality policy:",
      JSON.stringify(input.generationConfig?.qualityGate ?? {}),
      "Create a fresh editorial title and section flow from the selected topic, product context, trend evidence, and keyword evidence.",
      "Never use these title formulas: 'Guide: Choosing, Using, and Optimizing ...', 'How to Choose, Use, and Style ...', or '[keyword] Guide'.",
      "Do not use the internal campaign/task name as article topic or title.",
      "Do not try to evade AI detectors. Instead, make the article specific, evidence-aware, varied in rhythm, useful to shoppers, and free of generic template phrases."
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

  let finalArticle = enforceInternalLinks(article.data, context);
  const imageAsset = await maybeGenerateArticleImage(provider, finalArticle, input, context);
  if (imageAsset?.publicUrl) {
    finalArticle = {
      ...finalArticle,
      imagePrompt: imageAsset.prompt,
      imageAlt: imageAsset.altText,
      bodyHtml: injectImageFigure(finalArticle.bodyHtml, imageAsset.publicUrl, imageAsset.altText, input.generationConfig)
    };
  } else if (imageAsset?.prompt) {
    finalArticle = {
      ...finalArticle,
      imagePrompt: imageAsset.prompt,
      imageAlt: imageAsset.altText
    };
  }

  const qualityInput = normalizeFinalQualityInput(input);
  const finalSeo = await scoreFinalArticle(finalArticle, qualityInput);
  const finalQuality = await defaultQualityGate.evaluate(toHtmlAssembly(finalArticle), finalSeo, qualityInput, context);

  return {
    article: {
      ...finalArticle,
      seoScore: finalSeo.score,
      qualityPassed: finalQuality.passed
    },
    seo: finalSeo,
    quality: finalQuality,
    imageAsset,
    metadata: {
      id: result.id,
      model: result.model ?? provider.textModel,
      finishReason: result.finishReason,
      usage: result.usage
    }
  };
}

function enforceInternalLinks(article: GeneratedArticle, context: ContentSourceContext): GeneratedArticle {
  const links = context.internalLinks?.slice(0, context.generationConfig?.internalLinks?.maxLinks ?? 4) ?? [];
  if (!context.generationConfig?.internalLinks?.enabled || links.length === 0) return article;
  if (links.some((link) => article.bodyHtml.includes(link.url))) return article;

  const list = links
    .map((link) => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.anchor ?? link.title)}</a></li>`)
    .join("");
  const heading = article.locale === "zh-CN" ? "相关商品与延伸阅读" : "Related products and reading";

  return {
    ...article,
    bodyHtml: `${article.bodyHtml}<section><h2>${heading}</h2><ul>${list}</ul></section>`
  };
}

async function maybeGenerateArticleImage(
  provider: ResolvedAiProvider,
  article: GeneratedArticle,
  input: ParsedGenerationInput,
  context: ContentSourceContext
): Promise<ImageAssetDraft | undefined> {
  if (input.generationConfig?.imageGeneration?.enabled === false) return undefined;

  const referenceLimit =
    input.generationConfig?.imageGeneration?.referenceImageLimit ??
    input.generationConfig?.productImageReference?.maxImages ??
    6;
  const referenceImageUrls = uniqueStrings(context.imageReferences?.map((item) => item.url) ?? []).slice(0, referenceLimit);
  const prompt = composeImagePrompt(article.imagePrompt ?? buildFallbackImagePrompt(article, context), context, referenceImageUrls);
  const altText = article.imageAlt ?? article.title;

  if (!provider.imageModel) {
    return {
      prompt,
      altText,
      error: "AI image model is not configured.",
      referenceImageUrls
    };
  }

  try {
    const client = createOpenAICompatibleClient({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.imageModel,
      timeoutMs: 120000
    });
    const image = await client.generateImage({
      model: provider.imageModel,
      prompt,
      size: "1536x864",
      responseFormat: "url",
      referenceImageUrls,
      extraBody: referenceImageUrls.length
        ? {
            reference_images: referenceImageUrls,
            fusion_mode: input.generationConfig?.imageGeneration?.fusionMode
          }
        : undefined
    });

    return imageToAssetDraft(image, prompt, altText, referenceImageUrls);
  } catch (error) {
    return {
      prompt,
      altText,
      error: getErrorMessage(error),
      referenceImageUrls
    };
  }
}

function imageToAssetDraft(
  image: GenerateImageResult,
  prompt: string,
  altText: string,
  referenceImageUrls: string[]
): ImageAssetDraft {
  const dataUrl = image.b64Json ? `data:image/png;base64,${image.b64Json}` : undefined;

  return {
    prompt: image.revisedPrompt ?? prompt,
    altText,
    publicUrl: image.url,
    sourceUrl: image.url ?? dataUrl,
    providerModel: image.model,
    referenceImageUrls
  };
}

function injectImageFigure(bodyHtml: string, imageUrl: string, altText: string, generationConfig?: GenerationConfig) {
  if (!imageUrl || bodyHtml.includes(imageUrl)) return bodyHtml;
  const figure = `<figure><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText)}" /></figure>`;
  const placement = generationConfig?.imageGeneration?.placement ?? "inline";
  if (placement === "featured") return `${figure}${bodyHtml}`;

  const firstParagraphEnd = bodyHtml.indexOf("</p>");
  if (firstParagraphEnd >= 0) {
    return `${bodyHtml.slice(0, firstParagraphEnd + 4)}${figure}${bodyHtml.slice(firstParagraphEnd + 4)}`;
  }

  return `${bodyHtml}${figure}`;
}

function normalizeFinalQualityInput(input: ParsedGenerationInput) {
  return {
    ...input,
    topic: input.topic ?? input.primaryKeyword ?? "Shopify blog topic"
  };
}

async function scoreFinalArticle(article: GeneratedArticle, input: ReturnType<typeof normalizeFinalQualityInput>) {
  return defaultSeoScorer.score(toHtmlAssembly(article), {
    locale: article.locale,
    primaryKeyword: article.primaryKeyword,
    secondaryKeywords: article.secondaryKeywords,
    longTailKeywords: [],
    searchIntent: input.sourceType === "manual_topic" ? "informational" : "commercial",
    audienceNeed: ""
  }, input);
}

function toHtmlAssembly(article: GeneratedArticle): HtmlAssemblyResult {
  return {
    title: article.title,
    handle: article.handle,
    summary: article.summary,
    bodyHtml: article.bodyHtml,
    tags: article.tags,
    imagePrompt: article.imagePrompt,
    imageAlt: article.imageAlt
  };
}

function buildFallbackImagePrompt(article: GeneratedArticle, context: ContentSourceContext): string {
  return [
    `Original ecommerce blog image for ${article.primaryKeyword}`,
    context.product ? `Product: ${context.product.title}` : "",
    context.collection ? `Collection: ${context.collection.title}` : "",
    context.generationConfig?.imageGeneration?.scenePrompt ? `Required scene: ${context.generationConfig.imageGeneration.scenePrompt}` : "",
    "realistic editorial ecommerce scene, natural light, clean background, 16:9 horizontal, no watermarks"
  ]
    .filter(Boolean)
    .join("; ");
}

function composeImagePrompt(basePrompt: string, context: ContentSourceContext, referenceImageUrls: string[]): string {
  const imageConfig = context.generationConfig?.imageGeneration;
  const additions = [
    imageConfig?.scenePrompt ? `Scene requirement: ${imageConfig.scenePrompt}` : "",
    imageConfig?.promptStyle ? `Style requirement: ${imageConfig.promptStyle}` : "",
    imageConfig?.fusionMode === "multi_product_fusion"
      ? "Use multi-image fusion: merge all referenced products into one coherent lifestyle scene, preserve product identity, color, scale, and material, no collage layout, no fake logos, no invented packaging text."
      : imageConfig?.fusionMode === "single_product"
        ? "Use one hero product as the main subject; keep other visual details secondary."
        : "Use a realistic lifestyle scene grounded in the referenced product images.",
    referenceImageUrls.length ? `Reference image URLs: ${referenceImageUrls.join(", ")}` : ""
  ].filter(Boolean);

  return uniqueStrings([basePrompt, ...additions]).join("; ");
}

async function persistGeneratedImageAsset(input: {
  organizationId: string;
  storeId: string;
  articleId: string;
  provider: string | null;
  asset: ImageAssetDraft;
}) {
  await prisma.generatedAsset.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      articleId: input.articleId,
      type: "inline_image",
      status: input.asset.error ? "failed" : input.asset.publicUrl || input.asset.sourceUrl ? "generated" : "requested",
      provider: isAiProvider(input.provider) ? input.provider : undefined,
      prompt: input.asset.prompt,
      altText: input.asset.altText,
      sourceUrl: input.asset.sourceUrl,
      publicUrl: input.asset.publicUrl,
      metadata: toPrismaJson({
        providerModel: input.asset.providerModel,
        referenceImageUrls: input.asset.referenceImageUrls,
        error: input.asset.error
      })
    }
  });
}

function isAiProvider(value: string | null): value is "openai" | "compatible" | "custom" {
  return value === "openai" || value === "compatible" || value === "custom";
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
      jobId: job.data.publishJobId,
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
  const generationConfig = resolveGenerationConfig(data.generationConfig, campaign?.metadata);
  const initialTopic = campaign?.topic ?? article?.title ?? data.topic;
  const [brandVoice, requestedSourceContext] = await Promise.all([
    loadBrandVoice(data.organizationId, data.storeId, locale, campaign?.brandVoice),
    loadSourceContext(data.storeId, sourceType, sourceId)
  ]);
  const baseSourceContext =
    shouldAutoDiscoverTopic(generationConfig, initialTopic) && !hasCatalogContext(requestedSourceContext)
      ? await loadFallbackCatalogContext(data.storeId)
      : requestedSourceContext;
  const seedKeywords = resolveSeedKeywords(data, campaign);
  const sourceContextBase = {
    ...baseSourceContext,
    topic: initialTopic,
    seedKeywords,
    generationConfig
  } satisfies ContentSourceContext;
  const [trendSignals, internalLinks, imageReferences] = await Promise.all([
    discoverTrendSignals({
      topic:
        initialTopic ??
        data.primaryKeyword ??
        seedKeywords?.[0] ??
        baseSourceContext.product?.title ??
        baseSourceContext.collection?.title ??
        "Shopify blog topic",
      locale,
      generationConfig,
      context: sourceContextBase
    }),
    loadInternalLinks(store.myshopifyDomain, data.storeId, sourceType, sourceId, generationConfig),
    loadImageReferences(data.storeId, sourceContextBase, generationConfig)
  ]);
  const enrichedContextBase = {
    ...sourceContextBase,
    trendSignals,
    internalLinks,
    imageReferences
  } satisfies ContentSourceContext;
  const topicSelectionInput = {
    organizationId: data.organizationId,
    storeId: data.storeId,
    locale,
    sourceType,
    sourceId: sourceId ?? undefined,
    topic:
      initialTopic ??
      data.primaryKeyword ??
      seedKeywords?.[0] ??
      baseSourceContext.product?.title ??
      baseSourceContext.collection?.title ??
      "Shopify blog topic",
    publishPolicy: campaign?.publishPolicy ?? data.publishPolicy,
    targetWordCount: campaign?.targetWordCount ?? data.targetWordCount,
    primaryKeyword: campaign?.primaryKeyword ?? data.primaryKeyword,
    generationConfig
  };
  const shouldAutoSelect = shouldAutoDiscoverTopic(generationConfig, initialTopic);
  const topicSelection = shouldAutoSelect ? selectTopicCandidate(topicSelectionInput, enrichedContextBase) : undefined;
  const resolvedTopic = topicSelection?.selected.topic ?? initialTopic ?? topicSelectionInput.topic;
  const keywordEvidence = topicSelection?.selected.evidence;

  return {
    store,
    campaign,
    article,
    aiProvider,
    sourceContext: {
      ...sourceContextBase,
      brandVoice: brandVoice
        ? {
            locale,
            audience: brandVoice.audience ?? undefined,
            tone: brandVoice.tone ?? undefined,
            bannedWords: brandVoice.bannedWords ?? [],
            examples: brandVoice.examples ?? []
          }
        : undefined,
      topic: resolvedTopic,
      seedKeywords,
      trendSignals,
      internalLinks,
      imageReferences,
      keywordEvidence,
      topicSelection,
      generationConfig
    } satisfies ContentSourceContext
  };
}

function mergeGenerationInput(
  data: BlogGenerationJobData,
  campaign: GenerationCampaignInput | null,
  resolvedTopic?: string
) {
  return {
    organizationId: data.organizationId,
    storeId: data.storeId,
    locale: campaign?.locale ?? data.locale,
    sourceType: campaign?.sourceType ?? data.sourceType,
    sourceId: campaign?.sourceId ?? data.sourceId,
    topic: resolvedTopic ?? campaign?.topic ?? data.topic ?? data.primaryKeyword,
    publishPolicy: campaign?.publishPolicy ?? data.publishPolicy,
    targetWordCount: campaign?.targetWordCount ?? data.targetWordCount,
    primaryKeyword: campaign?.primaryKeyword ?? data.primaryKeyword,
    generationConfig: resolveGenerationConfig(data.generationConfig, campaign?.metadata)
  };
}

function resolveSeedKeywords(data: BlogGenerationJobData, campaign: GenerationCampaignInput | null): string[] | undefined {
  const keywords = [
    ...(campaign?.keywords ?? []),
    ...(Array.isArray(data.keywords) ? data.keywords : []),
    data.primaryKeyword
  ]
    .map((keyword) => (typeof keyword === "string" ? keyword.trim() : ""))
    .filter(Boolean);

  return keywords.length ? Array.from(new Set(keywords)) : undefined;
}

function shouldAutoDiscoverTopic(generationConfig: GenerationConfig | undefined, explicitTopic: string | null | undefined): boolean {
  const config = generationConfig?.topicDiscovery;
  if (config?.enabled === false) return !explicitTopic;
  return config?.enabled === true || !explicitTopic;
}

async function persistCampaignTopicSelection(campaignId: string | undefined, topicSelection: TopicSelectionResult | undefined) {
  if (!campaignId || !topicSelection) return;

  const campaign = await prisma.blogCampaign.findUnique({
    where: { id: campaignId },
    select: { topic: true, metadata: true }
  });
  if (!campaign) return;

  const metadata = isRecord(campaign.metadata) ? campaign.metadata : {};
  await prisma.blogCampaign.update({
    where: { id: campaignId },
    data: {
      topic: campaign.topic ?? topicSelection.selected.topic,
      metadata: toPrismaJson({
        ...metadata,
        topicSelection
      })
    }
  });
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

function hasCatalogContext(context: ContentSourceContext): boolean {
  return Boolean(context.product || context.collection);
}

async function loadFallbackCatalogContext(storeId: string): Promise<ContentSourceContext> {
  const [product, collection] = await Promise.all([
    prisma.productSnapshot.findFirst({
      where: { storeId },
      orderBy: { syncedAt: "desc" }
    }),
    prisma.collectionSnapshot.findFirst({
      where: { storeId },
      orderBy: { syncedAt: "desc" }
    })
  ]);

  if (product) {
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

  if (collection) {
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

function resolveGenerationConfig(jobConfig: unknown, campaignMetadata: unknown): GenerationConfig | undefined {
  const fromJob = isRecord(jobConfig) ? jobConfig : undefined;
  const metadata = isRecord(campaignMetadata) ? campaignMetadata : {};
  const fromMetadata = isRecord(metadata.generationConfig) ? metadata.generationConfig : undefined;
  const candidate = fromJob ?? fromMetadata;
  if (!candidate) return undefined;

  return {
    topicDiscovery: isRecord(candidate.topicDiscovery)
      ? {
          enabled: candidate.topicDiscovery.enabled !== false,
          strategy: topicDiscoveryStrategy(candidate.topicDiscovery.strategy),
          maxCandidates: numberValue(candidate.topicDiscovery.maxCandidates),
          preferTrendSignals: candidate.topicDiscovery.preferTrendSignals !== false,
          minEvidenceScore: numberValue(candidate.topicDiscovery.minEvidenceScore)
        }
      : undefined,
    hotNews: isRecord(candidate.hotNews)
      ? {
          enabled: candidate.hotNews.enabled === true,
          query: stringValue(candidate.hotNews.query),
          geo: stringValue(candidate.hotNews.geo) ?? "US",
          lookbackDays: numberValue(candidate.hotNews.lookbackDays),
          maxItems: numberValue(candidate.hotNews.maxItems),
          sources: stringArray(candidate.hotNews.sources).filter((source): source is "google_news" | "google_trends" =>
            ["google_news", "google_trends"].includes(source)
          )
        }
      : undefined,
    internalLinks: isRecord(candidate.internalLinks)
      ? {
          enabled: candidate.internalLinks.enabled !== false,
          maxLinks: numberValue(candidate.internalLinks.maxLinks),
          strategy: linkStrategy(candidate.internalLinks.strategy)
        }
      : undefined,
    imageGeneration: isRecord(candidate.imageGeneration)
      ? {
          enabled: candidate.imageGeneration.enabled !== false,
          placement: imagePlacement(candidate.imageGeneration.placement),
          promptStyle: stringValue(candidate.imageGeneration.promptStyle),
          scenePrompt: stringValue(candidate.imageGeneration.scenePrompt),
          fusionMode: imageFusionMode(candidate.imageGeneration.fusionMode),
          referenceImageLimit: numberValue(candidate.imageGeneration.referenceImageLimit)
        }
      : undefined,
    productImageReference: isRecord(candidate.productImageReference)
      ? {
          enabled: candidate.productImageReference.enabled !== false,
          source: productImageReferenceSource(candidate.productImageReference.source),
          productIds: stringArray(candidate.productImageReference.productIds),
          imageUrls: stringArray(candidate.productImageReference.imageUrls),
          maxImages: numberValue(candidate.productImageReference.maxImages),
          maxImagesPerProduct: numberValue(candidate.productImageReference.maxImagesPerProduct)
        }
      : undefined,
    qualityGate: isRecord(candidate.qualityGate)
      ? {
          enabled: candidate.qualityGate.enabled !== false,
          minSeoScore: numberValue(candidate.qualityGate.minSeoScore),
          minEditorialScore: numberValue(candidate.qualityGate.minEditorialScore),
          requireTrendEvidence: candidate.qualityGate.requireTrendEvidence === true,
          rejectTemplatePatterns: candidate.qualityGate.rejectTemplatePatterns !== false
        }
      : undefined
  };
}

async function loadInternalLinks(
  shopDomain: string,
  storeId: string,
  sourceType: string,
  sourceId: string | null | undefined,
  generationConfig: GenerationConfig | undefined
): Promise<InternalLinkCandidate[]> {
  const config = generationConfig?.internalLinks;
  if (!config?.enabled) return [];

  const limit = config.maxLinks ?? 4;
  const strategy = config.strategy ?? "auto";
  const [products, collections, articles] = await Promise.all([
    strategy === "collection" || strategy === "article"
      ? Promise.resolve([])
      : prisma.productSnapshot.findMany({
          where: {
            storeId,
            shopifyProductId: sourceType === "product" && sourceId ? { not: sourceId } : undefined
          },
          orderBy: { syncedAt: "desc" },
          take: limit
        }),
    strategy === "product" || strategy === "article"
      ? Promise.resolve([])
      : prisma.collectionSnapshot.findMany({
          where: {
            storeId,
            shopifyCollectionId: sourceType === "collection" && sourceId ? { not: sourceId } : undefined
          },
          orderBy: { syncedAt: "desc" },
          take: limit
        }),
    strategy === "product" || strategy === "collection"
      ? Promise.resolve([])
      : prisma.blogArticle.findMany({
          where: {
            storeId,
            status: "published",
            handle: { not: null }
          },
          orderBy: { publishedAt: "desc" },
          take: limit
        })
  ]);

  return [
    ...products.map((product) => ({
      title: product.title,
      url: `https://${shopDomain}/products/${product.handle}`,
      type: "product" as const,
      anchor: product.seoTitle ?? product.title,
      reason: product.productType ?? undefined
    })),
    ...collections.map((collection) => ({
      title: collection.title,
      url: `https://${shopDomain}/collections/${collection.handle}`,
      type: "collection" as const,
      anchor: collection.title
    })),
    ...articles.map((article) => ({
      title: article.title ?? "Related article",
      url: article.canonicalUrl ?? `https://${shopDomain}/blogs/news/${article.handle}`,
      type: "article" as const,
      anchor: article.title ?? article.primaryKeyword ?? "Related article"
    }))
  ].slice(0, limit);
}

async function loadImageReferences(
  storeId: string,
  context: ContentSourceContext,
  generationConfig: GenerationConfig | undefined
): Promise<NonNullable<ContentSourceContext["imageReferences"]>> {
  const config = generationConfig?.productImageReference;
  if (!config?.enabled) return [];
  const maxImages = config.maxImages ?? generationConfig?.imageGeneration?.referenceImageLimit ?? 6;
  const maxImagesPerProduct = config.maxImagesPerProduct ?? 2;

  const manual = (config.imageUrls ?? []).map((url) => ({
    url,
    source: "manual" as const,
    title: "Manual reference image"
  }));
  const sourceImages = [
    ...(context.product?.imageUrls ?? []).map((url) => ({ url, source: "product" as const, title: context.product?.title })),
    ...(context.collection?.imageUrls ?? []).map((url) => ({ url, source: "collection" as const, title: context.collection?.title }))
  ];

  if (config.source !== "selected_products" || !config.productIds?.length) {
    return dedupeImageReferences([...sourceImages, ...manual]).slice(0, maxImages);
  }

  const selected = await prisma.productSnapshot.findMany({
    where: {
      storeId,
      OR: config.productIds.flatMap((id) => [{ id }, { shopifyProductId: id }, { handle: id }])
    },
    take: maxImages
  });

  return dedupeImageReferences([
    ...selected.flatMap((product) =>
      (product.imageUrls ?? []).slice(0, maxImagesPerProduct).map((url) => ({
        url,
        source: "product" as const,
        title: product.title
      }))
    ),
    ...sourceImages,
    ...manual
  ]).slice(0, maxImages);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item));
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function dedupeImageReferences(
  references: NonNullable<ContentSourceContext["imageReferences"]>
): NonNullable<ContentSourceContext["imageReferences"]> {
  const seen = new Set<string>();
  const output: NonNullable<ContentSourceContext["imageReferences"]> = [];
  for (const reference of references) {
    if (!reference.url || seen.has(reference.url)) continue;
    seen.add(reference.url);
    output.push(reference);
  }
  return output;
}

function linkStrategy(value: unknown): "auto" | "product" | "collection" | "article" | undefined {
  return value === "auto" || value === "product" || value === "collection" || value === "article" ? value : undefined;
}

function imagePlacement(value: unknown): "featured" | "inline" | "both" | undefined {
  return value === "featured" || value === "inline" || value === "both" ? value : undefined;
}

function topicDiscoveryStrategy(value: unknown): "trend_product_fit" | "seo_opportunity" | "product_education" | undefined {
  return value === "trend_product_fit" || value === "seo_opportunity" || value === "product_education" ? value : undefined;
}

function imageFusionMode(value: unknown): "single_product" | "multi_product_fusion" | "lifestyle_scene" | undefined {
  return value === "single_product" || value === "multi_product_fusion" || value === "lifestyle_scene" ? value : undefined;
}

function productImageReferenceSource(value: unknown): "source_product" | "selected_products" | "urls" | undefined {
  return value === "source_product" || value === "selected_products" || value === "urls" ? value : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
