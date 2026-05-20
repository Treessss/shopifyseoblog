import type { Job } from "bullmq";
import { AIClientError, createOpenAICompatibleClient, type GenerateImageResult, type GenerateTextResult } from "@shopify-ai-blog/ai";
import { maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import {
  defaultQualityGate,
  defaultSeoScorer,
  discoverTrendSignals,
  runContentPipeline,
  type ContentSourceContext,
  type HtmlAssemblyResult,
  type InternalLinkCandidate,
  type KeywordEvidenceItem,
  type QualityGateResult,
  selectTopicCandidate,
  type TopicHistoryItem,
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
  type ProductOptionContext,
  type ProductVariantContext,
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

interface AiSearchReviewResult {
  score: number;
  passed: boolean;
  searchIntentScore: number;
  titleCtrScore: number;
  contentDepthScore: number;
  keywordFitScore: number;
  topicalAuthorityScore: number;
  conversionSupportScore: number;
  summary: string;
  strengths: string[];
  recommendations: string[];
  revisionBrief: string[];
  actionItems: AiSearchActionItem[];
}

interface AiSearchActionItem {
  priority: "critical" | "high" | "medium";
  area: string;
  issue: string;
  concreteEdit: string;
  acceptanceCheck: string;
}

interface AiSearchRevisionPass {
  pass: number;
  beforeScore: number;
  afterScore: number;
  recommendations: string[];
  changes: string[];
}

interface AiSearchReviewWorkflow {
  enabled: boolean;
  minTrafficScore: number;
  maxRevisionPasses: number;
  initial: AiSearchReviewResult;
  final: AiSearchReviewResult;
  revisions: AiSearchRevisionPass[];
  unavailable?: boolean;
  warning?: string;
}

interface HighScoreStructureCheck {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

interface HighScoreStructureReport {
  passed: boolean;
  checks: HighScoreStructureCheck[];
  issues: string[];
}

interface ResolvedCatalogSource {
  sourceType: Extract<SourceType, "product" | "collection">;
  sourceId: string;
  title: string;
  handle?: string;
}

interface ProductSnapshotSourceRow {
  id: string;
  shopifyProductId: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  productType: string | null;
  vendor: string | null;
  status: string | null;
  tags: string[];
  imageUrls: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  options: unknown;
  variants: unknown;
}

interface CollectionSnapshotSourceRow {
  id: string;
  shopifyCollectionId: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  imageUrl: string | null;
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
    const input = mergeGenerationInput(job.data, context.campaign, context.sourceContext.topic, context.resolvedSource);
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
    await persistCampaignGenerationResolution(context.campaign?.id, context.sourceContext.topicSelection, context.resolvedSource);
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
        aiSearchReview: aiResult.aiSearchReview,
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
          finalSeo: aiResult.seo,
          aiSearchReview: aiResult.aiSearchReview
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
    await markCampaignCompleted(context.campaign?.id);
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

async function markCampaignCompleted(campaignId: string | undefined): Promise<void> {
  if (!campaignId) return;

  const articles = await prisma.blogArticle.findMany({
    where: { campaignId },
    select: { status: true }
  });
  const hasOpenArticles = articles.some((article: { status: string }) =>
    ["draft", "publishing"].includes(article.status)
  );
  const hasGeneratedArticle = articles.some((article: { status: string }) =>
    ["quality_failed", "ready_to_publish", "published"].includes(article.status)
  );
  const completed = articles.length > 0 && hasGeneratedArticle && !hasOpenArticles;

  await prisma.blogCampaign.update({
    where: { id: campaignId },
    data: {
      status: completed ? "completed" : "active",
      completedAt: completed ? new Date() : undefined
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
  quality: QualityGateResult & { aiSearchReview?: AiSearchReviewWorkflow; highScoreStructure?: HighScoreStructureReport };
  imageAsset?: ImageAssetDraft;
  aiSearchReview?: AiSearchReviewWorkflow;
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
        sourceContext: contextForAiEditing(context)
      }),
      context.recentTopics?.length
        ? [
            "Do not repeat or lightly rewrite these previous topics/titles from this store and language:",
            JSON.stringify(context.recentTopics.slice(0, 16))
          ].join("\n")
        : "",
      "Required quality policy:",
      JSON.stringify(input.generationConfig?.qualityGate ?? {}),
      highScoreArticleContract(input, context).join("\n"),
      "Create a fresh editorial title and section flow from the selected topic, product context, trend evidence, and keyword evidence.",
      "Use verified product facts, synced options, variants, SEO descriptions, images, and tags when available. If material, protection, compatibility, or fit details are missing, say they are not confirmed instead of guessing.",
      "The article title must be meaningfully different from previous topics and titles, not just a synonym swap.",
      "Never use these title formulas: 'Guide: Choosing, Using, and Optimizing ...', 'How to Choose, Use, and Style ...', or '[keyword] Guide'.",
      "Do not use the internal campaign/task name as article topic or title.",
      "Do not try to evade AI detectors. Instead, make the article specific, evidence-aware, varied in rhythm, useful to shoppers, and free of generic template phrases."
    ].join("\n\n"),
    maxTokens: Math.max(2400, Math.min(8000, input.targetWordCount * 5)),
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
  let aiSearchReview = await runAiSearchReviewWorkflow(client, provider, finalArticle, input, context, pipelineResult).catch((error) =>
    recoverAiSearchReviewFailure(error, input, "initial-review")
  );
  if (aiSearchReview.revisedArticle) {
    finalArticle = enforceInternalLinks(aiSearchReview.revisedArticle, context);
  }
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
  aiSearchReview = await finalizeAiSearchReviewWorkflow(client, provider, aiSearchReview, finalArticle, input, context, pipelineResult).catch((error) =>
    recoverAiSearchReviewFailure(error, input, "final-review", aiSearchReview)
  );
  if (aiSearchReview.revisedArticle) {
    finalArticle = enforceInternalLinks(aiSearchReview.revisedArticle, context);
    if (imageAsset?.publicUrl && !finalArticle.bodyHtml.includes(imageAsset.publicUrl)) {
      finalArticle = {
        ...finalArticle,
        bodyHtml: injectImageFigure(finalArticle.bodyHtml, imageAsset.publicUrl, imageAsset.altText, input.generationConfig)
      };
    }
  }

  const qualityInput = normalizeFinalQualityInput(input);
  const finalSeo = await scoreFinalArticle(finalArticle, qualityInput);
  const localQuality = await defaultQualityGate.evaluate(toHtmlAssembly(finalArticle), finalSeo, qualityInput, context);
  const finalStructure = evaluateHighScoreArticleStructure(finalArticle, qualityInput, context);
  const finalQuality = applyAiSearchReviewGate(localQuality, aiSearchReview.workflow, finalStructure);

  return {
    article: {
      ...finalArticle,
      seoScore: finalSeo.score,
      qualityPassed: finalQuality.passed
    },
    seo: finalSeo,
    quality: finalQuality,
    imageAsset,
    aiSearchReview: aiSearchReview.workflow,
    metadata: {
      id: result.id,
      model: result.model ?? provider.textModel,
      finishReason: result.finishReason,
      usage: result.usage
    }
  };
}

async function runAiSearchReviewWorkflow(
  client: ReturnType<typeof createOpenAICompatibleClient>,
  provider: ResolvedAiProvider,
  article: GeneratedArticle,
  input: ParsedGenerationInput,
  context: ContentSourceContext,
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>
): Promise<{ workflow?: AiSearchReviewWorkflow; revisedArticle?: GeneratedArticle }> {
  const config = resolveAiSearchReviewConfig(input.generationConfig);
  if (!config.enabled) return {};

  const initial = applyHighScoreStructureReview(
    await reviewArticleForSearchTraffic(client, provider, article, input, context, pipelineResult, "initial"),
    evaluateHighScoreArticleStructure(article, input, context),
    input
  );
  let currentArticle = article;
  let currentReview = initial;
  const revisions: AiSearchRevisionPass[] = [];

  for (let pass = 1; pass <= config.maxRevisionPasses; pass += 1) {
    if (currentReview.score >= config.minTrafficScore) break;

    const revisedArticle = enforceInternalLinks(
      await reviseArticleForSearchTraffic(client, provider, currentArticle, currentReview, input, context, pipelineResult, pass),
      context
    );
    const revisedReview = applyHighScoreStructureReview(
      await reviewArticleForSearchTraffic(client, provider, revisedArticle, input, context, pipelineResult, `revision-${pass}`),
      evaluateHighScoreArticleStructure(revisedArticle, input, context),
      input
    );
    revisions.push({
      pass,
      beforeScore: currentReview.score,
      afterScore: revisedReview.score,
      recommendations: concreteReviewInstructions(currentReview),
      changes: revisedReview.strengths
    });
    currentArticle = revisedArticle;
    currentReview = revisedReview;
  }

  return {
    workflow: {
      enabled: true,
      minTrafficScore: config.minTrafficScore,
      maxRevisionPasses: config.maxRevisionPasses,
      initial,
      final: currentReview,
      revisions
    },
    revisedArticle: revisions.length > 0 ? currentArticle : undefined
  };
}

async function finalizeAiSearchReviewWorkflow(
  client: ReturnType<typeof createOpenAICompatibleClient>,
  provider: ResolvedAiProvider,
  result: { workflow?: AiSearchReviewWorkflow; revisedArticle?: GeneratedArticle },
  finalArticle: GeneratedArticle,
  input: ParsedGenerationInput,
  context: ContentSourceContext,
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>
): Promise<{ workflow?: AiSearchReviewWorkflow; revisedArticle?: GeneratedArticle }> {
  if (!result.workflow) return result;

  let currentArticle = finalArticle;
  let currentReview = applyHighScoreStructureReview(
    await reviewArticleForSearchTraffic(client, provider, currentArticle, input, context, pipelineResult, "final-saved-article"),
    evaluateHighScoreArticleStructure(currentArticle, input, context),
    input
  );
  const revisions = result.workflow.revisions.map((revision, index, allRevisions) =>
    index === allRevisions.length - 1 ? { ...revision, afterScore: currentReview.score } : revision
  );

  for (let pass = revisions.length + 1; pass <= result.workflow.maxRevisionPasses; pass += 1) {
    if (currentReview.score >= result.workflow.minTrafficScore) break;

    const revisedArticle = await reviseArticleForSearchTraffic(
      client,
      provider,
      currentArticle,
      currentReview,
      input,
      context,
      pipelineResult,
      pass
    );
    currentArticle = enforceInternalLinks(revisedArticle, context);
    const revisedReview = applyHighScoreStructureReview(
      await reviewArticleForSearchTraffic(client, provider, currentArticle, input, context, pipelineResult, `final-revision-${pass}`),
      evaluateHighScoreArticleStructure(currentArticle, input, context),
      input
    );
    revisions.push({
      pass,
      beforeScore: currentReview.score,
      afterScore: revisedReview.score,
      recommendations: concreteReviewInstructions(currentReview),
      changes: revisedReview.strengths
    });
    currentReview = revisedReview;
  }

  return {
    ...result,
    workflow: {
      ...result.workflow,
      final: currentReview,
      revisions
    },
    revisedArticle: currentArticle !== finalArticle ? currentArticle : result.revisedArticle
  };
}

async function reviewArticleForSearchTraffic(
  client: ReturnType<typeof createOpenAICompatibleClient>,
  provider: ResolvedAiProvider,
  article: GeneratedArticle,
  input: ParsedGenerationInput,
  context: ContentSourceContext,
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>,
  stage: string
): Promise<AiSearchReviewResult> {
  const result = await client.generateText({
    model: provider.textModel,
    temperature: 0.15,
    system:
      "You are a senior SEO editor for ecommerce content. Score search traffic potential using evidence, search intent, helpfulness, and content quality. Be strict, practical, and specific.",
    prompt: [
      "Return only a JSON object matching this shape:",
      JSON.stringify({
        score: 0,
        searchIntentScore: 0,
        titleCtrScore: 0,
        contentDepthScore: 0,
        keywordFitScore: 0,
        topicalAuthorityScore: 0,
        conversionSupportScore: 0,
        summary: "short reason for the score",
        strengths: ["specific strength"],
        recommendations: ["specific improvement that can be applied in the next edit"],
        revisionBrief: ["concrete edit instruction"],
        actionItems: [
          {
            priority: "critical",
            area: "title | intro | section | internal links | facts | FAQ | conversion",
            issue: "what is weak right now",
            concreteEdit: "the exact section, table, paragraph, link, or FAQ to add/change",
            acceptanceCheck: "how to verify the edit is complete"
          }
        ]
      }),
      "Score means likelihood to earn non-brand organic search traffic, not just keyword stuffing.",
      "Use 0-100 integers. Penalize generic buying-guide content, weak search intent, thin examples, unsupported claims, title formulas, missing internal links, and weak product/category fit.",
      "Use this high-score contract as the scoring rubric. Do not give 82+ unless the article substantially satisfies it:",
      highScoreArticleContract(input, context).join("\n"),
      "Use localStructureReport as a hard sanity check. If it has failed checks, the score must stay below the minimum and the failed checks must become actionItems.",
      `If the score is below ${resolveAiSearchReviewConfig(input.generationConfig).minTrafficScore}, return at least 5 actionItems. Each actionItem must be section-specific, directly editable, and include an acceptanceCheck. Avoid vague advice like 'add more detail'.`,
      "Make revisionBrief an ordered checklist that an editor can apply immediately. Name the exact H2/table/FAQ/internal link/product fact to add or replace.",
      "Ignore low-relevance trend evidence. Penalize the article if unrelated news or trend terms appear in the copy.",
      "Do not recommend tricks to evade AI detectors. Recommend evidence-aware, useful, specific editorial improvements.",
      JSON.stringify({
        stage,
        locale: input.locale,
        targetWordCount: input.targetWordCount,
        selectedTopic: context.topic ?? input.topic,
        primaryKeyword: article.primaryKeyword,
        secondaryKeywords: article.secondaryKeywords,
        topicSelection: compactTopicSelection(context.topicSelection),
        keywordEvidence: filterKeywordEvidence(context.keywordEvidence ?? pipelineResult.artifacts.keywordEvidence)
          ?.slice(0, 10)
          .map(compactKeywordEvidenceItem),
        trendSignals: relevantTrendSignals(context).slice(0, 6).map(compactTrendSignal),
        internalLinks: mixInternalLinkCandidates([context.internalLinks ?? []], 6).map(compactInternalLinkCandidate),
        product: compactProductContext(context.product),
        collection: compactCollectionContext(context.collection),
        recentTopics: context.recentTopics?.slice(0, 12),
        localStructureReport: evaluateHighScoreArticleStructure(article, input, context),
        article: articleForAiReview(article)
      })
    ].join("\n\n"),
    maxTokens: 2200,
    responseFormat: { type: "json_object" }
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(result.content));
  } catch (error) {
    throw domainError("AI_SEARCH_REVIEW_INVALID_JSON", "AI search review returned non-JSON output.", {
      retryable: true,
      details: {
        error: getErrorMessage(error),
        responsePreview: trimForDb(result.content, 800)
      }
    });
  }

  return normalizeAiSearchReview(parsed, input.generationConfig);
}

async function reviseArticleForSearchTraffic(
  client: ReturnType<typeof createOpenAICompatibleClient>,
  provider: ResolvedAiProvider,
  article: GeneratedArticle,
  review: AiSearchReviewResult,
  input: ParsedGenerationInput,
  context: ContentSourceContext,
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>,
  pass: number
): Promise<GeneratedArticle> {
  const result = await client.generateText({
    model: provider.textModel,
    temperature: Math.min(0.45, provider.temperature),
    system:
      "You are a senior ecommerce SEO editor. Rewrite the article to improve search traffic potential while preserving factual accuracy, locale, useful product context, and clean Shopify-compatible HTML.",
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
      `Revision pass ${pass}. Improve the article based on this AI search review:`,
      JSON.stringify(review),
      revisionModeInstruction(pass, review, input),
      `Target outcome: the revised article should be strong enough to score at least ${targetAiSearchScore(input)} in the next AI search traffic review, not merely clear the minimum ${resolveAiSearchReviewConfig(input.generationConfig).minTrafficScore}.`,
      "This is a hard quality contract for the returned article:",
      highScoreArticleContract(input, context).join("\n"),
      "The localStructureReport in the context is a non-negotiable validator. Repair every failed check before making style improvements.",
      "Apply the recommendations concretely. Improve title intent, opening specificity, section depth, internal-link context, product/category evidence, and shopper usefulness.",
      "Treat revisionBrief and actionItems as a required checklist. Satisfy every acceptanceCheck that can be satisfied with the supplied evidence, and remove unrelated trend/news terms.",
      "Before returning, audit your own draft: if an actionItem asks for a section, table, FAQ, internal link, product fact box, comparison, or CTA, it must actually exist in bodyHtml.",
      "When score is low because the article is generic, restructure heavily instead of making small wording changes.",
      "Keep the article in the same locale. Do not invent product facts, prices, discounts, testimonials, rankings, medical/legal claims, or unsupported statistics.",
      "Use synced product options, variants, image context, SEO descriptions, and tags as facts. If important specs are missing, state that they are not confirmed and shift the angle to styling, gifting, cleaning, comparison, or shopper fit.",
      "If currentArticle already contains an image figure or generated image URL, preserve it unless it is broken or irrelevant.",
      "For ecommerce product content, prefer concrete modules: verified facts table, variant/finish decision table, choose-this-if/skip-this-if section, contextual internal links, FAQ, and a complete buyer-facing conclusion.",
      `Aim for ${highScoreMinWordCount(input)}-${Math.round(input.targetWordCount * 1.15)} words. Do not end with an unfinished FAQ, heading, list, or sentence.`,
      "Do not repeat old title formulas or create another generic guide. Do not start the title with 'How to Choose', 'Guide', 'Best', or the bare product keyword unless the review explicitly requires that exact query format. Do not use the campaign/task name as the title.",
      "Use semantic HTML sections with H2 headings and natural keyword placement.",
      JSON.stringify({
        sourceStrategy: articleForAiReview(pipelineResult.article),
        sourceContext: contextForAiEditing(context),
        localStructureReport: evaluateHighScoreArticleStructure(article, input, context),
        currentArticle: articleForAiRevision(article)
      })
    ].join("\n\n"),
    maxTokens: Math.max(2400, Math.min(8000, input.targetWordCount * 5)),
    responseFormat: { type: "json_object" }
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(result.content));
  } catch (error) {
    throw domainError("AI_REVISION_INVALID_JSON", "AI article revision returned non-JSON output.", {
      retryable: true,
      details: {
        error: getErrorMessage(error),
        responsePreview: trimForDb(result.content, 800)
      }
    });
  }

  const revised = generatedArticleSchema.safeParse(parsed);
  if (!revised.success) {
    throw domainError("AI_REVISION_SCHEMA_INVALID", "AI article revision failed schema validation.", {
      retryable: true,
      details: revised.error.flatten()
    });
  }

  return {
    ...revised.data,
    imagePrompt: revised.data.imagePrompt ?? article.imagePrompt,
    imageAlt: revised.data.imageAlt ?? article.imageAlt
  };
}

function applyAiSearchReviewGate(
  quality: QualityGateResult,
  workflow: AiSearchReviewWorkflow | undefined,
  structure?: HighScoreStructureReport
): QualityGateResult & { aiSearchReview?: AiSearchReviewWorkflow; highScoreStructure?: HighScoreStructureReport } {
  if (!workflow?.enabled) return quality;

  const structurePassed = structure?.passed ?? true;
  const scorePassed = !workflow.unavailable && workflow.final.score >= workflow.minTrafficScore;
  const searchPassed = scorePassed && structurePassed;
  const reasons = [...quality.reasons];
  const warnings = [...quality.warnings];
  if (workflow.unavailable) {
    reasons.push(workflow.warning ?? "AI search traffic review was unavailable, so the article needs manual review.");
  }
  if (!scorePassed) {
    reasons.push(`AI search traffic score ${workflow.final.score} is below ${workflow.minTrafficScore}.`);
  }
  if (structure && !structure.passed) {
    reasons.push(...structure.issues.slice(0, 6));
  }
  if (workflow.revisions.length > 0) {
    warnings.push(`AI revised and rescored this article ${workflow.revisions.length} time(s).`);
  }

  return {
    ...quality,
    passed: quality.passed && searchPassed,
    reasons,
    warnings,
    aiSearchReview: workflow,
    highScoreStructure: structure
  };
}

function resolveAiSearchReviewConfig(generationConfig: GenerationConfig | undefined): {
  enabled: boolean;
  minTrafficScore: number;
  maxRevisionPasses: number;
} {
  const config = generationConfig?.aiSearchReview;
  return {
    enabled: config?.enabled !== false,
    minTrafficScore: clampPercent(config?.minTrafficScore ?? 82),
    maxRevisionPasses: Math.max(0, Math.min(5, Math.round(config?.maxRevisionPasses ?? 3)))
  };
}

function targetAiSearchScore(input: ParsedGenerationInput): number {
  const minimum = resolveAiSearchReviewConfig(input.generationConfig).minTrafficScore;
  return Math.min(96, Math.max(90, minimum + 8));
}

function highScoreArticleContract(input: ParsedGenerationInput, context: ContentSourceContext): string[] {
  const minimum = resolveAiSearchReviewConfig(input.generationConfig).minTrafficScore;
  const target = targetAiSearchScore(input);
  const product = context.product;
  const collection = context.collection;
  const configuredInternalLinkLimit = Math.max(0, context.generationConfig?.internalLinks?.maxLinks ?? 4);
  const availableInternalLinks = mixInternalLinkCandidates(
    [context.internalLinks ?? []],
    configuredInternalLinkLimit
  ).length;
  const requiredInternalLinks =
    context.generationConfig?.internalLinks?.enabled === false
      ? 0
      : Math.min(configuredInternalLinkLimit, availableInternalLinks);
  const hasVariantOptions = Boolean(product?.options?.length || product?.variants?.length);
  const sourceLabel = product?.title ?? collection?.title ?? input.topic ?? input.primaryKeyword ?? "the selected topic";

  return [
    `High-score target: write for ${target}+ AI search traffic score; ${minimum} is only the minimum gate.`,
    `Primary source anchor: ${sourceLabel}. The article must feel built from this source, not from a reusable template.`,
    "Hard requirements:",
    "- Title: specific search intent + clear differentiator. Avoid formula starts like 'How to Choose', 'Guide', 'Best', or '[keyword]: ...' unless the exact query demands it.",
    "- Intro: within the first 120 words, state who the article is for, the concrete buying/search question, the verified product/category anchor, and the decision the reader will be able to make.",
    "- Direct answer: include a 40-60 word answer-first block near the top that could stand alone in a featured snippet or AI answer.",
    "- Search intent: map the H2s to clear intent stages: quick answer, verified facts, comparison/decision, practical use, internal next step, FAQ.",
    "- Keyword evidence: use primary, secondary, and long-tail terms because they match the topic and buyer intent; avoid forcing unrelated trend/news keywords.",
    "- Evidence: include a compact verified-facts section or table using only synced product/category facts. Also include a 'not confirmed' note for important unknowns instead of guessing.",
    hasVariantOptions
      ? "- Decision depth: include a variant/finish/fit decision table using synced options or variants, with 'best for' guidance for each relevant option."
      : "- Decision depth: include a concrete comparison table or decision matrix based on shopper fit, use case, styling, gifting, care, or category tradeoffs.",
    "- Product/image specificity: reference visible product-image observations only when supported by supplied images or metadata; avoid generic material/protection claims.",
    requiredInternalLinks > 0
      ? `- Internal links: include at least ${requiredInternalLinks} contextual internal links with natural anchor text and a reason in the surrounding sentence.`
      : "- Internal links: if no candidates are supplied, do not invent links.",
    "- Usefulness: include choose-this-if / skip-this-if guidance, practical pre-purchase checks, and at least one concrete scenario a shopper would recognize.",
    "- FAQ: include at least 5 non-generic FAQ items that answer search-intent questions about fit, variant choice, care, styling/gifting, and confirmed vs unknown details.",
    "- Structure: every H2 must answer a real search or purchase decision. Avoid generic filler headings and avoid repeated paragraph rhythm.",
    "- Completeness: no truncated sentence, unfinished FAQ, empty section, placeholder, or abrupt ending. End with a buyer-facing conclusion and a contextual CTA.",
    "- Safety: no unsupported prices beyond synced variant data, no discounts, no testimonials, no fake rankings, no medical/legal claims, no unrelated trend terms."
  ];
}

function revisionModeInstruction(pass: number, review: AiSearchReviewResult, input: ParsedGenerationInput): string {
  const minimum = resolveAiSearchReviewConfig(input.generationConfig).minTrafficScore;
  if (pass >= 2 || review.score < minimum - 10) {
    return [
      "Revision mode: FULL REBUILD.",
      "The current structure did not score high enough. You may replace the title, intro, section order, H2s, tables, FAQ, and conclusion.",
      "Keep only accurate facts, useful links, and any valid image figure. Do not preserve weak structure just for continuity."
    ].join(" ");
  }

  return [
    "Revision mode: STRICT TARGETED REWRITE.",
    "Apply all actionItems and revisionBrief items as concrete edits, not wording tweaks.",
    "If the requested sections or tables are missing, add them now."
  ].join(" ");
}

function evaluateHighScoreArticleStructure(
  article: GeneratedArticle,
  input: ParsedGenerationInput,
  context: ContentSourceContext
): HighScoreStructureReport {
  const html = article.bodyHtml ?? "";
  const text = stripHtmlForReview(html);
  const locale = article.locale ?? input.locale;
  const minWords = highScoreMinWordCount(input);
  const wordCount = estimateReviewWordCount(text, locale);
  const requiredInternalLinks = expectedInternalLinkCount(context);
  const internalLinks = extractArticleLinkUrls(html).size;
  const faqCount = countFaqQuestions(html, text, locale);
  const checks: HighScoreStructureCheck[] = [
    structureCheck(
      "answer-first",
      "40-60 word answer-first block near the top",
      hasAnswerFirstBlock(html, text, locale),
      "Add a labeled quick-answer block immediately after the intro."
    ),
    structureCheck(
      "verified-facts",
      "Verified facts table or compact fact box",
      hasVerifiedFactsSection(html, text, locale),
      "Add a verified facts table/fact box grounded only in synced product or collection data."
    ),
    structureCheck(
      "decision-table",
      "Comparison or decision table",
      hasDecisionTable(html, text, locale),
      "Add a table that compares variants, fit, finish, use case, care, or shopper tradeoffs."
    ),
    structureCheck(
      "choose-skip",
      "Choose-this-if / skip-this-if guidance",
      hasChooseSkipGuidance(text, locale),
      "Add a choose-this-if / skip-this-if section with concrete buyer guidance."
    ),
    structureCheck(
      "faq-depth",
      "At least five FAQ questions",
      faqCount >= 5,
      `Add enough non-generic FAQ items; detected ${faqCount}, expected at least 5.`
    ),
    structureCheck(
      "internal-links",
      "Required contextual internal links",
      internalLinks >= requiredInternalLinks,
      `Add ${Math.max(0, requiredInternalLinks - internalLinks)} more contextual internal link(s); detected ${internalLinks}, expected ${requiredInternalLinks}.`
    ),
    structureCheck(
      "word-depth",
      "Useful depth near target word count",
      wordCount >= minWords,
      `Expand specific sections; estimated ${wordCount} words, expected at least ${minWords}.`
    ),
    structureCheck(
      "complete-ending",
      "Complete buyer-facing ending",
      !hasLikelyTruncatedEnding(html, text),
      "Finish the last section with a complete sentence and buyer-facing conclusion; no unfinished heading/list/FAQ."
    )
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => `${check.label}: ${check.detail ?? "Not satisfied."}`);

  return {
    passed: issues.length === 0,
    checks,
    issues
  };
}

function applyHighScoreStructureReview(
  review: AiSearchReviewResult,
  structure: HighScoreStructureReport,
  input: ParsedGenerationInput
): AiSearchReviewResult {
  if (structure.passed) return review;

  const minTrafficScore = resolveAiSearchReviewConfig(input.generationConfig).minTrafficScore;
  const structuralScore = Math.min(review.score, Math.max(0, minTrafficScore - 24), Math.max(0, minTrafficScore - 1));
  const structureItems: AiSearchActionItem[] = structure.issues.slice(0, 8).map((issue) => ({
    priority: "critical",
    area: "structure",
    issue,
    concreteEdit: issue,
    acceptanceCheck: "Local high-score structure validation passes for this item."
  }));

  return {
    ...review,
    score: structuralScore,
    passed: false,
    contentDepthScore: Math.min(review.contentDepthScore, structuralScore),
    conversionSupportScore: Math.min(review.conversionSupportScore, structuralScore),
    summary: `${review.summary} Local high-score structure validation failed: ${structure.issues.slice(0, 3).join(" | ")}`,
    recommendations: uniqueStrings([...structure.issues, ...review.recommendations]).slice(0, 10),
    revisionBrief: uniqueStrings([
      "Repair every local high-score structure failure before stylistic edits.",
      ...structure.issues,
      ...review.revisionBrief
    ]).slice(0, 10),
    actionItems: [...structureItems, ...review.actionItems].slice(0, 10)
  };
}

function structureCheck(key: string, label: string, passed: boolean, detail: string): HighScoreStructureCheck {
  return {
    key,
    label,
    passed,
    detail: passed ? undefined : detail
  };
}

function expectedInternalLinkCount(context: ContentSourceContext): number {
  const configuredInternalLinkLimit = Math.max(0, context.generationConfig?.internalLinks?.maxLinks ?? 4);
  if (context.generationConfig?.internalLinks?.enabled === false || configuredInternalLinkLimit === 0) return 0;
  return Math.min(configuredInternalLinkLimit, mixInternalLinkCandidates([context.internalLinks ?? []], configuredInternalLinkLimit).length);
}

function highScoreMinWordCount(input: ParsedGenerationInput): number {
  const proportionalMinimum = Math.round(input.targetWordCount * 0.85);
  if (input.targetWordCount < 900) return Math.max(450, proportionalMinimum);
  return Math.max(900, proportionalMinimum);
}

function hasAnswerFirstBlock(html: string, text: string, locale: SupportedLocale): boolean {
  const topHtml = html.slice(0, 1600);
  const topText = text.slice(0, 900);
  if (locale === "zh-CN") {
    return /(快速答案|直接答案|结论先说|简短答案|一句话结论)/i.test(topHtml) || /^(?:[^。！？]*[。！？]){2,4}/.test(topText);
  }

  return /(quick answer|short answer|answer first|bottom line|the short version|quick take)/i.test(topHtml);
}

function hasVerifiedFactsSection(html: string, text: string, locale: SupportedLocale): boolean {
  const hasFactsHeading =
    locale === "zh-CN"
      ? /(已确认|事实|商品信息|规格|未确认|不确定|未提供)/i.test(text)
      : /(verified|confirmed|facts|specs|not confirmed|not listed|not provided|unknown)/i.test(text);
  return hasFactsHeading && (/<table\b/i.test(html) || /<ul\b/i.test(html));
}

function hasDecisionTable(html: string, text: string, locale: SupportedLocale): boolean {
  const decisionTerms =
    locale === "zh-CN"
      ? /(对比|比较|决策|选择|适合|不适合|场景|用途|取舍|版本|款式|颜色|材质|搭配|送礼)/
      : /(compare|comparison|decision|matrix|choose|skip|best for|use case|variant|finish|fit|tradeoff|vs\.?|gift|style|care)/i;
  const tables = Array.from(html.matchAll(/<table\b[\s\S]*?<\/table>/gi)).map((match) => stripHtmlForReview(match[0] ?? ""));
  if (tables.some((tableText) => decisionTerms.test(tableText))) return true;

  const tableNearDecisionHeading =
    locale === "zh-CN"
      ? /(对比|比较|决策|选择|适合|不适合|场景|用途|取舍)[\s\S]{0,900}<table\b/i.test(html)
      : /(compare|comparison|decision|choose|skip|best for|use case|variant|finish|fit|tradeoff|vs\.?)[\s\S]{0,900}<table\b/i.test(html);
  return tableNearDecisionHeading && decisionTerms.test(text);
}

function hasChooseSkipGuidance(text: string, locale: SupportedLocale): boolean {
  if (locale === "zh-CN") return /(适合|不适合|选这个|可以跳过|不建议|购买前)/i.test(text);
  return /(choose this if|skip this if|best for|avoid this if|buy it if|do not buy|pre-purchase|before you buy)/i.test(text);
}

function countFaqQuestions(html: string, text: string, locale: SupportedLocale): number {
  const faqIndex = locale === "zh-CN" ? text.search(/常见问题|问答|FAQ/i) : text.search(/FAQ|frequently asked|questions/i);
  const faqText = faqIndex >= 0 ? text.slice(faqIndex) : text;
  const questionMarks = (faqText.match(/[?？]/g) ?? []).length;
  const questionHeadings = Array.from(html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)).filter((match) =>
    /[?？]|^(?:Q[:：]|问[:：])|^(?:Can|Do|Does|Is|Are|Should|Which|What|When|Why|How)\b/i.test(stripHtmlForReview(match[1] ?? ""))
  ).length;
  return Math.max(questionMarks, questionHeadings);
}

function hasLikelyTruncatedEnding(html: string, text: string): boolean {
  const trimmedHtml = html.trim();
  const trimmedText = text.trim();
  if (!trimmedHtml || !trimmedText) return true;
  if (/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>\s*$/i.test(trimmedHtml)) return true;
  if (/<(?:ul|ol|table|tbody|thead|tr|section|p|li)\b[^>]*>\s*$/i.test(trimmedHtml)) return true;
  if (/\b(?:and|or|with|for|to|because|including|such as|while|when|if|by|from|the|a|an)\s*$/i.test(trimmedText)) return true;
  return !/[.!?。！？)"'”’]$/.test(trimmedText);
}

function estimateReviewWordCount(text: string, locale: SupportedLocale): number {
  const latinWords = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  if (locale !== "zh-CN") return latinWords;
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return latinWords + Math.ceil(cjkChars / 2);
}

function normalizeAiSearchReview(value: unknown, generationConfig: GenerationConfig | undefined): AiSearchReviewResult {
  const record = isRecord(value) ? value : {};
  const minTrafficScore = resolveAiSearchReviewConfig(generationConfig).minTrafficScore;
  const score = clampPercent(numberValue(record.score) ?? averageReviewDimensions(record));

  return {
    score,
    passed: score >= minTrafficScore,
    searchIntentScore: clampPercent(numberValue(record.searchIntentScore) ?? score),
    titleCtrScore: clampPercent(numberValue(record.titleCtrScore) ?? score),
    contentDepthScore: clampPercent(numberValue(record.contentDepthScore) ?? score),
    keywordFitScore: clampPercent(numberValue(record.keywordFitScore) ?? score),
    topicalAuthorityScore: clampPercent(numberValue(record.topicalAuthorityScore) ?? score),
    conversionSupportScore: clampPercent(numberValue(record.conversionSupportScore) ?? score),
    summary: stringValue(record.summary) ?? "AI search review completed.",
    strengths: stringArray(record.strengths).slice(0, 8),
    recommendations: stringArray(record.recommendations).slice(0, 10),
    revisionBrief: stringArray(record.revisionBrief).slice(0, 10),
    actionItems: normalizeAiSearchActionItems(record.actionItems, record.recommendations, record.revisionBrief).slice(0, 10)
  };
}

function normalizeAiSearchActionItems(
  value: unknown,
  recommendations: unknown,
  revisionBrief: unknown
): AiSearchActionItem[] {
  const items = Array.isArray(value)
    ? value.map((item) => {
        if (!isRecord(item)) return undefined;
        const priority = stringValue(item.priority);
        const normalizedPriority: AiSearchActionItem["priority"] =
          priority === "critical" || priority === "high" || priority === "medium" ? priority : "high";
        const area = stringValue(item.area);
        const issue = stringValue(item.issue);
        const concreteEdit = stringValue(item.concreteEdit);
        const acceptanceCheck = stringValue(item.acceptanceCheck);
        if (!area || !issue || !concreteEdit) return undefined;
        return {
          priority: normalizedPriority,
          area,
          issue,
          concreteEdit,
          acceptanceCheck: acceptanceCheck ?? `确认 ${area} 已按修改点完成。`
        };
      })
    : [];

  const normalized = items.filter((item): item is AiSearchActionItem => Boolean(item));
  if (normalized.length > 0) return normalized;

  return [...stringArray(revisionBrief), ...stringArray(recommendations)].slice(0, 8).map((item) => ({
    priority: "high",
    area: "article",
    issue: item,
    concreteEdit: item,
    acceptanceCheck: "文章中可以直接看到该修改点已经落地。"
  }));
}

function concreteReviewInstructions(review: AiSearchReviewResult): string[] {
  const actionItems = review.actionItems.map((item) =>
    `${item.area}: ${item.concreteEdit} 验收: ${item.acceptanceCheck}`
  );
  return uniqueStrings([...actionItems, ...review.revisionBrief, ...review.recommendations]).slice(0, 12);
}

function averageReviewDimensions(record: Record<string, unknown>): number {
  const values = [
    numberValue(record.searchIntentScore),
    numberValue(record.titleCtrScore),
    numberValue(record.contentDepthScore),
    numberValue(record.keywordFitScore),
    numberValue(record.topicalAuthorityScore),
    numberValue(record.conversionSupportScore)
  ].filter((value): value is number => typeof value === "number");

  if (values.length === 0) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function articleForAiReview(article: GeneratedArticle) {
  return {
    title: article.title,
    handle: article.handle,
    summary: article.summary,
    primaryKeyword: article.primaryKeyword,
    secondaryKeywords: article.secondaryKeywords,
    tags: article.tags,
    locale: article.locale,
    bodyText: stripHtmlForReview(article.bodyHtml).slice(0, 7000),
    bodyHtmlPreview: article.bodyHtml.slice(0, 1800)
  };
}

function articleForAiRevision(article: GeneratedArticle) {
  return {
    ...articleForAiReview(article),
    seoScore: article.seoScore,
    qualityPassed: article.qualityPassed,
    imagePrompt: article.imagePrompt,
    imageAlt: article.imageAlt,
    bodyHtml: trimForPrompt(article.bodyHtml, 12000)
  };
}

function contextForAiEditing(context: ContentSourceContext): ContentSourceContext {
  return {
    product: compactProductContext(context.product),
    collection: compactCollectionContext(context.collection),
    brandVoice: context.brandVoice,
    topic: context.topic,
    seedKeywords: context.seedKeywords?.slice(0, 8),
    competitorTitles: context.competitorTitles?.slice(0, 8),
    trendSignals: relevantTrendSignals(context).slice(0, 6).map(compactTrendSignal),
    internalLinks: mixInternalLinkCandidates([context.internalLinks ?? []], context.generationConfig?.internalLinks?.maxLinks ?? 4).map(
      compactInternalLinkCandidate
    ),
    imageReferences: context.imageReferences?.slice(0, 6),
    keywordEvidence: filterKeywordEvidence(context.keywordEvidence)?.slice(0, 10).map(compactKeywordEvidenceItem),
    topicSelection: compactTopicSelection(context.topicSelection),
    recentTopics: context.recentTopics?.slice(0, 12),
    generationConfig: context.generationConfig
  };
}

function compactProductContext(product: ContentSourceContext["product"]): ContentSourceContext["product"] {
  if (!product) return undefined;

  return {
    ...product,
    description: product.description ? trimForPrompt(stripHtmlForReview(product.description), 1200) : undefined,
    tags: product.tags.slice(0, 12),
    imageUrls: product.imageUrls.slice(0, 6),
    seoTitle: product.seoTitle ? trimForPrompt(product.seoTitle, 180) : undefined,
    seoDescription: product.seoDescription ? trimForPrompt(product.seoDescription, 360) : undefined,
    options: product.options?.slice(0, 6).map((option) => ({
      ...option,
      values: option.values.slice(0, 16)
    })),
    variants: product.variants?.slice(0, 10).map((variant) => ({
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
      availableForSale: variant.availableForSale,
      selectedOptions: variant.selectedOptions?.map((option) => ({
        ...option,
        values: option.values.slice(0, 4)
      }))
    })),
    facts: product.facts?.slice(0, 14).map((fact) => trimForPrompt(fact, 220))
  };
}

function compactCollectionContext(collection: ContentSourceContext["collection"]): ContentSourceContext["collection"] {
  if (!collection) return undefined;

  return {
    ...collection,
    description: collection.description ? trimForPrompt(stripHtmlForReview(collection.description), 1000) : undefined,
    imageUrls: collection.imageUrls?.slice(0, 4)
  };
}

function compactTopicSelection(selection: TopicSelectionResult | undefined): TopicSelectionResult | undefined {
  if (!selection) return undefined;

  return {
    selected: compactTopicCandidate(selection.selected),
    candidates: selection.candidates.slice(0, 4).map(compactTopicCandidate)
  };
}

function compactTopicCandidate(candidate: TopicSelectionResult["selected"]): TopicSelectionResult["selected"] {
  return {
    ...candidate,
    topic: trimForPrompt(candidate.topic, 260),
    primaryKeyword: trimForPrompt(candidate.primaryKeyword, 120),
    reasons: candidate.reasons.slice(0, 5).map((reason) => trimForPrompt(reason, 160)),
    evidence: candidate.evidence.slice(0, 6).map(compactKeywordEvidenceItem)
  };
}

function compactKeywordEvidenceItem(item: KeywordEvidenceItem): KeywordEvidenceItem {
  return {
    ...item,
    label: trimForPrompt(item.label, 120),
    value: trimForPrompt(item.value, 220),
    snippet: item.snippet ? trimForPrompt(item.snippet, 360) : undefined,
    metric: item.metric ? trimForPrompt(item.metric, 120) : undefined
  };
}

function compactTrendSignal(signal: TrendSignal): TrendSignal {
  return {
    ...signal,
    title: trimForPrompt(signal.title, 220),
    summary: signal.summary ? trimForPrompt(signal.summary, 360) : undefined
  };
}

function compactInternalLinkCandidate(link: InternalLinkCandidate): InternalLinkCandidate {
  return {
    ...link,
    title: trimForPrompt(link.title, 180),
    anchor: link.anchor ? trimForPrompt(link.anchor, 120) : undefined,
    reason: link.reason ? trimForPrompt(link.reason, 180) : undefined
  };
}

function recoverAiSearchReviewFailure(
  error: unknown,
  input: ParsedGenerationInput,
  stage: string,
  current?: { workflow?: AiSearchReviewWorkflow; revisedArticle?: GeneratedArticle }
): { workflow: AiSearchReviewWorkflow; revisedArticle?: GeneratedArticle } {
  if (!isAiSearchReviewUnavailableError(error)) {
    throw error;
  }

  const unavailable = unavailableAiSearchReview(input, stage, error);
  if (!current?.workflow) {
    return { workflow: unavailable };
  }

  return {
    ...current,
    workflow: {
      ...current.workflow,
      final: unavailable.final,
      unavailable: true,
      warning: unavailable.warning
    }
  };
}

function unavailableAiSearchReview(input: ParsedGenerationInput, stage: string, error: unknown): AiSearchReviewWorkflow {
  const config = resolveAiSearchReviewConfig(input.generationConfig);
  const message = trimForPrompt(getErrorMessage(error), 240);
  const result: AiSearchReviewResult = {
    score: 0,
    passed: false,
    searchIntentScore: 0,
    titleCtrScore: 0,
    contentDepthScore: 0,
    keywordFitScore: 0,
    topicalAuthorityScore: 0,
    conversionSupportScore: 0,
    summary: `AI search traffic review was unavailable during ${stage}: ${message}`,
    strengths: [],
    recommendations: ["Retry AI scoring when the provider connection is stable, then apply the returned search-traffic recommendations."],
    revisionBrief: ["Manual review required because the AI search traffic review did not complete."],
    actionItems: [
      {
        priority: "critical",
        area: "AI review",
        issue: "AI search traffic review did not complete.",
        concreteEdit: "Retry AI scoring when the provider connection is stable.",
        acceptanceCheck: "The article has a completed AI search traffic score and concrete revision guidance."
      }
    ]
  };

  return {
    enabled: true,
    minTrafficScore: config.minTrafficScore,
    maxRevisionPasses: config.maxRevisionPasses,
    initial: result,
    final: result,
    revisions: [],
    unavailable: true,
    warning: result.summary
  };
}

function isAiSearchReviewUnavailableError(error: unknown): boolean {
  if (error instanceof AIClientError) {
    return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || (error.status ?? 0) >= 500;
  }

  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  if (/fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_SOCKET/i.test(error.message)) return true;

  const cause = (error as Error & { cause?: unknown }).cause;
  if (!isRecord(cause)) return false;

  const code = typeof cause.code === "string" ? cause.code : "";
  return ["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(code);
}

function trimForPrompt(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function relevantTrendSignals(context: ContentSourceContext): TrendSignal[] {
  const hasCatalogAnchor = Boolean(context.product || context.collection || context.seedKeywords?.length);
  const seen = new Set<string>();
  const output: TrendSignal[] = [];

  for (const signal of context.trendSignals ?? []) {
    if (hasCatalogAnchor && typeof signal.relevanceScore === "number" && signal.relevanceScore <= 0) continue;
    const key = (signal.url || signal.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(signal);
  }

  return output;
}

function filterKeywordEvidence(items: KeywordEvidenceItem[] | undefined): KeywordEvidenceItem[] | undefined {
  if (!Array.isArray(items)) return items;

  return items.filter((item) => {
    if (item.type !== "trend") return true;
    const relevance = item.relevanceScore;
    return relevance === undefined || relevance > 0;
  });
}

function stripHtmlForReview(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function enforceInternalLinks(article: GeneratedArticle, context: ContentSourceContext): GeneratedArticle {
  const links = mixInternalLinkCandidates([context.internalLinks ?? []], context.generationConfig?.internalLinks?.maxLinks ?? 4);
  if (!context.generationConfig?.internalLinks?.enabled || links.length === 0) return article;
  const existingUrls = extractArticleLinkUrls(article.bodyHtml);
  const missingLinks = links.filter((link) => !existingUrls.has(normalizeInternalLinkUrl(link.url)));
  if (missingLinks.length === 0) return article;

  const list = renderInternalLinkItems(missingLinks);
  const bodyWithUpdatedLinks = appendLinksToRelatedSection(article.bodyHtml, list);
  if (bodyWithUpdatedLinks !== article.bodyHtml) {
    return {
      ...article,
      bodyHtml: bodyWithUpdatedLinks
    };
  }

  const heading = article.locale === "zh-CN" ? "相关商品与延伸阅读" : "Related products and reading";

  return {
    ...article,
    bodyHtml: `${article.bodyHtml}<section><h2>${heading}</h2><ul>${list}</ul></section>`
  };
}

function renderInternalLinkItems(links: InternalLinkCandidate[]): string {
  return links.map((link) => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.anchor ?? link.title)}</a></li>`).join("");
}

function appendLinksToRelatedSection(bodyHtml: string, listItems: string): string {
  const pattern =
    /(<section\b[^>]*>\s*<h2\b[^>]*>\s*(?:相关商品与延伸阅读|继续了解|Related products and reading|Keep exploring)\s*<\/h2>\s*<ul\b[^>]*>)([\s\S]*?)(<\/ul>\s*<\/section>)/i;
  if (!pattern.test(bodyHtml)) return bodyHtml;
  return bodyHtml.replace(pattern, (_match, before: string, currentItems: string, after: string) => `${before}${currentItems}${listItems}${after}`);
}

function extractArticleLinkUrls(bodyHtml: string): Set<string> {
  const urls = new Set<string>();
  const pattern = /<a\b[^>]*\shref=["']([^"']+)["'][^>]*>/gi;
  for (const match of bodyHtml.matchAll(pattern)) {
    const url = normalizeInternalLinkUrl(match[1] ?? "");
    if (url) urls.add(url);
  }
  return urls;
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
  const initialTopic = firstNonBlank(campaign?.topic, article?.title, data.topic);
  const [brandVoice, requestedSourceContext, recentTopics] = await Promise.all([
    loadBrandVoice(data.organizationId, data.storeId, locale, campaign?.brandVoice),
    loadSourceContext(data.storeId, sourceType, sourceId),
    loadRecentTopicHistory(data.organizationId, data.storeId, locale, campaign?.id ?? data.campaignId)
  ]);
  const baseSourceContext =
    shouldAutoDiscoverTopic(generationConfig, initialTopic) && !hasCatalogContext(requestedSourceContext)
      ? await loadFallbackCatalogContext(data.storeId, sourceType, recentTopics)
      : requestedSourceContext;
  const resolvedSource = resolveCatalogSource(sourceType, sourceId, baseSourceContext);
  const effectiveSourceType = resolvedSource?.sourceType ?? sourceType;
  const effectiveSourceId = resolvedSource?.sourceId ?? sourceId;
  const seedKeywords = resolveSeedKeywords(data, campaign);
  const topicSeed = isAutoGeneratedPlaceholderTopic(initialTopic) ? undefined : initialTopic;
  const fallbackTopicSeed = firstNonBlank(
    topicSeed,
    data.primaryKeyword,
    seedKeywords?.[0],
    baseSourceContext.product?.title,
    baseSourceContext.collection?.title,
    "Shopify blog topic"
  );
  const sourceContextBase = {
    ...baseSourceContext,
    topic: topicSeed,
    seedKeywords,
    recentTopics,
    generationConfig
  } satisfies ContentSourceContext;
  const [trendSignals, internalLinks, imageReferences] = await Promise.all([
    discoverTrendSignals({
      topic: fallbackTopicSeed ?? "Shopify blog topic",
      locale,
      generationConfig,
      context: sourceContextBase
    }),
    loadInternalLinks(store.myshopifyDomain, data.storeId, effectiveSourceType, effectiveSourceId, generationConfig, data.articleId),
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
    sourceType: effectiveSourceType,
    sourceId: effectiveSourceId ?? undefined,
    topic: fallbackTopicSeed ?? "Shopify blog topic",
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
    resolvedSource,
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
  resolvedTopic?: string,
  resolvedSource?: ResolvedCatalogSource
) {
  return {
    organizationId: data.organizationId,
    storeId: data.storeId,
    locale: campaign?.locale ?? data.locale,
    sourceType: resolvedSource?.sourceType ?? campaign?.sourceType ?? data.sourceType,
    sourceId: resolvedSource?.sourceId ?? campaign?.sourceId ?? data.sourceId,
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

async function loadRecentTopicHistory(
  organizationId: string,
  storeId: string,
  locale: string,
  campaignId?: string
): Promise<TopicHistoryItem[]> {
  const [campaigns, articles] = await Promise.all([
    prisma.blogCampaign.findMany({
      where: {
        organizationId,
        storeId,
        locale,
        ...(campaignId ? { id: { not: campaignId } } : {}),
        topic: {
          not: null
        }
      },
      select: {
        topic: true,
        sourceType: true,
        sourceId: true,
        primaryKeyword: true,
        createdAt: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 40
    }),
    prisma.blogArticle.findMany({
      where: {
        organizationId,
        storeId,
        locale,
        ...(campaignId ? { NOT: { campaignId } } : {}),
        title: {
          not: null
        }
      },
      select: {
        title: true,
        sourceType: true,
        sourceId: true,
        primaryKeyword: true,
        createdAt: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 60
    })
  ]);

  return dedupeTopicHistory([
    ...campaigns.map((campaign) => ({
      topic: campaign.topic ?? undefined,
      sourceType: campaign.sourceType,
      sourceId: campaign.sourceId ?? undefined,
      primaryKeyword: campaign.primaryKeyword ?? undefined,
      createdAt: campaign.createdAt.toISOString()
    })),
    ...articles.map((article) => ({
      title: article.title ?? undefined,
      sourceType: article.sourceType,
      sourceId: article.sourceId ?? undefined,
      primaryKeyword: article.primaryKeyword ?? undefined,
      createdAt: article.createdAt.toISOString()
    }))
  ]).slice(0, 60);
}

function dedupeTopicHistory(items: TopicHistoryItem[]): TopicHistoryItem[] {
  const seen = new Set<string>();
  const output: TopicHistoryItem[] = [];

  for (const item of items) {
    const key = normalizeHistoryKey(firstNonBlank(item.topic, item.title));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function normalizeHistoryKey(value: string | undefined): string {
  return (
    value
      ?.toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

function shouldAutoDiscoverTopic(generationConfig: GenerationConfig | undefined, explicitTopic: string | null | undefined): boolean {
  const config = generationConfig?.topicDiscovery;
  const hasExplicitTopic = Boolean(explicitTopic?.trim()) && !isAutoGeneratedPlaceholderTopic(explicitTopic);
  if (config?.enabled === false) return !hasExplicitTopic;
  return config?.enabled === true || !hasExplicitTopic;
}

async function persistCampaignGenerationResolution(
  campaignId: string | undefined,
  topicSelection: TopicSelectionResult | undefined,
  resolvedSource: ResolvedCatalogSource | undefined
) {
  if (!campaignId || (!topicSelection && !resolvedSource)) return;

  const campaign = await prisma.blogCampaign.findUnique({
    where: { id: campaignId },
    select: { topic: true, sourceId: true, metadata: true }
  });
  if (!campaign) return;

  const metadata = isRecord(campaign.metadata) ? campaign.metadata : {};
  const shouldPersistSelectedTopic =
    topicSelection &&
    (!campaign.topic || isAutoGeneratedPlaceholderTopic(campaign.topic) || campaign.topic === topicSelection.selected.topic);
  await prisma.blogCampaign.update({
    where: { id: campaignId },
    data: {
      topic: shouldPersistSelectedTopic ? topicSelection.selected.topic : campaign.topic,
      sourceType: resolvedSource && !campaign.sourceId ? resolvedSource.sourceType : undefined,
      sourceId: resolvedSource && !campaign.sourceId ? resolvedSource.sourceId : undefined,
      metadata: toPrismaJson({
        ...metadata,
        ...(topicSelection ? { topicSelection } : {}),
        ...(resolvedSource ? { sourceSelection: resolvedSource } : {})
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
        OR: [{ shopifyProductId: sourceId }, { id: sourceId }, { handle: sourceId }]
      },
      orderBy: { syncedAt: "desc" }
    });

    if (!product) return {};

    return productSourceContext(product);
  }

  if (sourceType === "collection") {
    const collection = await prisma.collectionSnapshot.findFirst({
      where: {
        storeId,
        OR: [{ shopifyCollectionId: sourceId }, { id: sourceId }, { handle: sourceId }]
      },
      orderBy: { syncedAt: "desc" }
    });

    if (!collection) return {};

    return collectionSourceContext(collection);
  }

  return {};
}

function hasCatalogContext(context: ContentSourceContext): boolean {
  return Boolean(context.product || context.collection);
}

async function loadFallbackCatalogContext(
  storeId: string,
  preferredSourceType: SourceType,
  recentTopics: TopicHistoryItem[]
): Promise<ContentSourceContext> {
  const [products, collections] = await Promise.all([
    prisma.productSnapshot.findMany({
      where: { storeId },
      orderBy: [{ syncedAt: "desc" }, { updatedAt: "desc" }],
      take: 80
    }),
    prisma.collectionSnapshot.findMany({
      where: { storeId },
      orderBy: [{ syncedAt: "desc" }, { updatedAt: "desc" }],
      take: 80
    })
  ]);
  const product = chooseCatalogCandidate(
    products,
    recentSourceIds(recentTopics, "product"),
    (candidate) => [candidate.shopifyProductId, candidate.id, candidate.handle]
  );
  const collection = chooseCatalogCandidate(
    collections,
    recentSourceIds(recentTopics, "collection"),
    (candidate) => [candidate.shopifyCollectionId, candidate.id, candidate.handle]
  );

  if (preferredSourceType === "collection" && collection) {
    return collectionSourceContext(collection);
  }

  if (product) {
    return productSourceContext(product);
  }

  if (collection) {
    return collectionSourceContext(collection);
  }

  return {};
}

function productSourceContext(product: ProductSnapshotSourceRow): ContentSourceContext {
  const options = normalizeProductOptions(product.options);
  const variants = normalizeProductVariants(product.variants);

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
      seoDescription: product.seoDescription ?? undefined,
      options,
      variants,
      facts: buildProductFacts(product, options, variants)
    }
  };
}

function normalizeProductOptions(value: unknown): ProductOptionContext[] {
  if (!Array.isArray(value)) return [];

  const output: ProductOptionContext[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = stringValue(item.name);
    const values = stringArray(item.values);
    if (!name || values.length === 0) continue;
    output.push({
      name,
      values: uniqueStrings(values)
    });
  }
  return output;
}

function normalizeProductVariants(value: unknown): ProductVariantContext[] {
  if (!Array.isArray(value)) return [];

  const output: ProductVariantContext[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const selectedOptions = Array.isArray(item.selectedOptions)
      ? item.selectedOptions
          .map((option) => {
            if (!isRecord(option)) return undefined;
            const name = stringValue(option.name);
            const selectedValue = stringValue(option.value);
            if (!name || !selectedValue) return undefined;
            return {
              name,
              values: [selectedValue]
            };
          })
          .filter((option): option is ProductOptionContext => Boolean(option))
      : undefined;

    output.push({
      title: stringValue(item.title),
      sku: stringValue(item.sku),
      price: stringValue(item.price) ?? numberValue(item.price)?.toString(),
      availableForSale: typeof item.availableForSale === "boolean" ? item.availableForSale : undefined,
      selectedOptions
    });
  }
  return output;
}

function buildProductFacts(
  product: ProductSnapshotSourceRow,
  options: ProductOptionContext[],
  variants: ProductVariantContext[]
): string[] {
  const optionFacts = options.map((option) => `${option.name}: ${option.values.slice(0, 8).join(", ")}`);
  const variantTitles = uniqueStrings(
    variants
      .map((variant) => variant.title)
      .filter((title): title is string => Boolean(title && title.toLowerCase() !== "default title"))
  ).slice(0, 6);
  const prices = uniqueStrings(variants.map((variant) => variant.price).filter((price): price is string => Boolean(price))).slice(0, 4);
  const skuCount = uniqueStrings(variants.map((variant) => variant.sku).filter((sku): sku is string => Boolean(sku))).length;
  const availability =
    variants.some((variant) => variant.availableForSale === true)
      ? "At least one synced variant is available for sale"
      : variants.length && variants.every((variant) => variant.availableForSale === false)
        ? "All synced variants are unavailable for sale"
        : undefined;

  return uniqueStrings([
    product.status ? `Shopify product status: ${product.status}` : undefined,
    product.productType ? `Product type: ${product.productType}` : undefined,
    product.vendor ? `Vendor: ${product.vendor}` : undefined,
    product.seoTitle ? `SEO title: ${product.seoTitle}` : undefined,
    product.seoDescription ? `SEO description: ${product.seoDescription}` : undefined,
    product.tags.length ? `Tags: ${product.tags.slice(0, 8).join(", ")}` : undefined,
    product.imageUrls.length ? `${product.imageUrls.length} synced product image(s)` : undefined,
    ...optionFacts,
    variantTitles.length ? `Variant titles: ${variantTitles.join(", ")}` : undefined,
    prices.length ? `Variant price values: ${prices.join(", ")}` : undefined,
    skuCount > 0 ? `${skuCount} synced SKU value(s)` : undefined,
    availability
  ]);
}

function collectionSourceContext(collection: CollectionSnapshotSourceRow): ContentSourceContext {
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

function resolveCatalogSource(
  requestedSourceType: SourceType,
  requestedSourceId: string | null | undefined,
  context: ContentSourceContext
): ResolvedCatalogSource | undefined {
  if (context.product) {
    return {
      sourceType: "product",
      sourceId: context.product.id,
      title: context.product.title,
      handle: context.product.handle
    };
  }

  if (context.collection) {
    return {
      sourceType: "collection",
      sourceId: context.collection.id,
      title: context.collection.title,
      handle: context.collection.handle
    };
  }

  if (requestedSourceType !== "manual_topic" && requestedSourceId) {
    return undefined;
  }

  return undefined;
}

function chooseCatalogCandidate<T>(candidates: T[], recentlyUsedIds: Set<string>, idsFor: (candidate: T) => string[]): T | undefined {
  if (candidates.length === 0) return undefined;

  const unusedCandidates = candidates.filter((candidate) => idsFor(candidate).every((id) => !recentlyUsedIds.has(id)));
  const pool = unusedCandidates.length > 0 ? unusedCandidates : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

function recentSourceIds(recentTopics: TopicHistoryItem[], sourceType: Extract<SourceType, "product" | "collection">): Set<string> {
  return new Set(
    recentTopics
      .filter((item) => item.sourceType === sourceType && item.sourceId)
      .map((item) => item.sourceId as string)
  );
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
      : undefined,
    aiSearchReview: isRecord(candidate.aiSearchReview)
      ? {
          enabled: candidate.aiSearchReview.enabled !== false,
          minTrafficScore: numberValue(candidate.aiSearchReview.minTrafficScore),
          maxRevisionPasses: numberValue(candidate.aiSearchReview.maxRevisionPasses)
        }
      : undefined
  };
}

async function loadInternalLinks(
  shopDomain: string,
  storeId: string,
  sourceType: string,
  sourceId: string | null | undefined,
  generationConfig: GenerationConfig | undefined,
  articleId?: string
): Promise<InternalLinkCandidate[]> {
  const config = generationConfig?.internalLinks;
  if (!config?.enabled) return [];

  const limit = config.maxLinks ?? 4;
  const strategy = config.strategy ?? "auto";
  const queryLimit = Math.max(limit * 2, 6);
  const includeProducts = strategy !== "collection" && strategy !== "article";
  const [sourceProduct, products, collections, articles] = await Promise.all([
    includeProducts && sourceType === "product" && sourceId
      ? prisma.productSnapshot.findFirst({
          where: {
            storeId,
            OR: [{ shopifyProductId: sourceId }, { id: sourceId }, { handle: sourceId }]
          },
          orderBy: { syncedAt: "desc" }
        })
      : Promise.resolve(null),
    strategy === "collection" || strategy === "article"
      ? Promise.resolve([])
      : prisma.productSnapshot.findMany({
          where: {
            storeId,
            shopifyProductId: sourceType === "product" && sourceId ? { not: sourceId } : undefined
          },
          orderBy: { syncedAt: "desc" },
          take: queryLimit
        }),
    strategy === "product" || strategy === "article"
      ? Promise.resolve([])
      : prisma.collectionSnapshot.findMany({
          where: {
            storeId,
            shopifyCollectionId: sourceType === "collection" && sourceId ? { not: sourceId } : undefined
          },
          orderBy: { syncedAt: "desc" },
          take: queryLimit
        }),
    strategy === "product" || strategy === "collection"
      ? Promise.resolve([])
      : prisma.blogArticle.findMany({
          where: {
            storeId,
            id: articleId ? { not: articleId } : undefined,
            status: "published",
            handle: { not: null }
          },
          orderBy: { publishedAt: "desc" },
          take: queryLimit
        })
  ]);

  const sourceProductLinks = sourceProduct
    ? [
        {
          title: sourceProduct.title,
          url: `https://${shopDomain}/products/${sourceProduct.handle}`,
          type: "product" as const,
          anchor: sourceProduct.seoTitle ?? sourceProduct.title,
          reason: sourceProduct.productType || "Primary product page"
        }
      ]
    : [];
  const productLinks = products.map((product) => ({
    title: product.title,
    url: `https://${shopDomain}/products/${product.handle}`,
    type: "product" as const,
    anchor: product.seoTitle ?? product.title,
    reason: product.productType ?? undefined
  }));
  const collectionLinks = collections.map((collection) => ({
    title: collection.title,
    url: `https://${shopDomain}/collections/${collection.handle}`,
    type: "collection" as const,
    anchor: collection.title
  }));
  const articleLinks = articles.map((article) => ({
    title: article.title ?? "Related article",
    url: article.canonicalUrl ?? `https://${shopDomain}/blogs/news/${article.handle}`,
    type: "article" as const,
    anchor: article.title ?? article.primaryKeyword ?? "Related article"
  }));

  return mixInternalLinkCandidates([sourceProductLinks, collectionLinks, articleLinks, productLinks], limit);
}

function mixInternalLinkCandidates(groups: InternalLinkCandidate[][], limit: number): InternalLinkCandidate[] {
  const seen = new Set<string>();
  const output: InternalLinkCandidate[] = [];
  const maxLength = Math.max(0, ...groups.map((group) => group.length));

  for (let index = 0; index < maxLength && output.length < limit; index += 1) {
    for (const group of groups) {
      const candidate = group[index];
      if (!candidate) continue;
      const key = normalizeInternalLinkUrl(candidate.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(candidate);
      if (output.length >= limit) break;
    }
  }

  return output;
}

function normalizeInternalLinkUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/g, "")}`;
  } catch {
    return value.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/g, "");
  }
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
  const handle = await resolveUniqueArticleHandle({
    articleId: input.articleId,
    campaignId: input.campaignId,
    storeId: input.storeId,
    locale: input.generated.locale,
    requestedHandle: input.generated.handle
  });
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
    handle,
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
        handle
      }
    },
    update: data,
    create: data
  });
}

async function resolveUniqueArticleHandle(input: {
  articleId?: string;
  campaignId?: string;
  storeId: string;
  locale: string;
  requestedHandle: string;
}): Promise<string> {
  const baseHandle = input.requestedHandle.trim() || fallbackArticleHandle(input);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? baseHandle : appendHandleSuffix(baseHandle, input.articleId ?? input.campaignId, attempt);
    const existing = await prisma.blogArticle.findUnique({
      where: {
        storeId_locale_handle: {
          storeId: input.storeId,
          locale: input.locale,
          handle: candidate
        }
      },
      select: {
        id: true,
        campaignId: true
      }
    });

    if (!existing) return candidate;
    if (input.articleId && existing.id === input.articleId) return candidate;
    if (!input.articleId && input.campaignId && existing.campaignId === input.campaignId) return candidate;
  }

  return appendHandleSuffix(baseHandle, `${input.campaignId ?? input.articleId ?? Date.now().toString(36)}-${Date.now().toString(36)}`, 0);
}

function appendHandleSuffix(baseHandle: string, identity: string | undefined, attempt: number): string {
  const suffix = compactHandleIdentity(identity) ?? Date.now().toString(36);
  const attemptSuffix = attempt > 1 ? `-${attempt}` : "";
  const maxBaseLength = Math.max(20, 80 - suffix.length - attemptSuffix.length - 1);
  const trimmedBase = baseHandle.replace(/-+$/g, "").slice(0, maxBaseLength).replace(/-+$/g, "") || "article";
  return `${trimmedBase}-${suffix}${attemptSuffix}`;
}

function compactHandleIdentity(identity: string | undefined): string | undefined {
  const normalized = identity?.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  if (!normalized) return undefined;
  return normalized.slice(-10);
}

function fallbackArticleHandle(input: { campaignId?: string; articleId?: string }): string {
  return `article-${compactHandleIdentity(input.articleId ?? input.campaignId) ?? Date.now().toString(36)}`;
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

function firstNonBlank(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function isAutoGeneratedPlaceholderTopic(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "shopify blog topic" ||
    /^how to choose\s*:/i.test(normalized) ||
    normalized === "自动选题" ||
    /^自动选题\s*[·-]/.test(normalized)
  );
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
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
