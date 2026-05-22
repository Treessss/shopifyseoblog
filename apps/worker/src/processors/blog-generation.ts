import type { Job } from "bullmq";
import { AIClientError, createOpenAICompatibleClient, type GenerateImageResult, type GenerateTextResult } from "@shopify-ai-blog/ai";
import { maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import {
  defaultQualityGate,
  defaultSeoScorer,
  discoverTrendSignals,
  runAgentContentPipeline,
  runContentPipeline,
  type AgentContentPipelineResult,
  buildCommercialSkillDoctrine,
  type AgentMemorySignal,
  type ContentPipelineResult,
  type ContentSourceContext,
  type ExternalReferenceCandidate,
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
  getShopInfo,
  uploadImageFile,
  type ShopifyArticleImageInput,
  type ShopifyGraphQLClient,
  type ShopifyArticle,
  type ShopifyUploadedImage,
  type ShopifyShopInfo
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
  parseIntegerEnv,
  throwForBullMQ,
  toPrismaJson,
  trimForDb,
  willRetryJob
} from "./shared";
import { resolveFreshStoreAccessToken } from "./shopify-token";
import {
  normalizeInternalLinkUrl,
  sanitizeArticleInternalLinks,
  verifyInternalLinkCandidates
} from "./internal-link-verification";

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
  id?: string;
  title: string | null;
  handle: string | null;
  bodyHtml: string | null;
  summary: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  tags: string[];
  shopifyArticleId: string | null;
  generationMetadata?: unknown;
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
  placement?: "featured" | "inline";
  index?: number;
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

interface GenerationProgressUpdate {
  step: string;
  label: string;
  percent: number;
  detail?: string;
  articleId?: string;
  status?: string;
}

export interface GenerationProgressPayload extends Record<string, unknown> {
  step: string;
  label: string;
  percent: number;
  detail?: string;
  articleId?: string;
  status?: string;
  bullJobId?: string;
  updatedAt: string;
  previousStep?: string;
  history?: GenerationProgressHistoryEntry[];
  staleUpdate?: GenerationProgressHistoryEntry;
}

export interface GenerationProgressHistoryEntry {
  step: string;
  label?: string;
  percent: number;
  status?: string;
  updatedAt?: string;
  stale?: boolean;
}

type GenerationProgressCallback = (progress: GenerationProgressUpdate) => Promise<void>;

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
  await job.updateProgress({ step: "article:queued", percent: 5, label: "任务已进入生成队列", sourceType: job.data.sourceType });
  await job.log(`Generating blog article for campaign ${job.data.campaignId ?? "ad-hoc"}`);

  let publishJob: Awaited<ReturnType<typeof startPublishJob>> | undefined;
  let articleId = job.data.articleId;

  try {
    const context = await loadGenerationContext(job.data);
    const campaignId = context.campaign?.id ?? job.data.campaignId;
    const updateProgress: GenerationProgressCallback = (progress) =>
      recordGenerationProgress(job, campaignId, publishJob?.id, progress);
    await updateProgress({
      step: "context:loaded",
      percent: 12,
      label: "已读取店铺与任务上下文",
      detail: context.sourceContext.topic ?? context.campaign?.title ?? job.data.topic
    });
    const input = mergeGenerationInput(job.data, context.campaign, context.sourceContext.topic, context.resolvedSource);
    const parsedInput = blogCampaignInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw domainError("BLOG_GENERATION_INPUT_INVALID", "Blog generation input is invalid.", {
        details: parsedInput.error.flatten()
      });
    }
    const generationInput = parsedInput.data;
    await updateProgress({
      step: "input:validated",
      percent: 16,
      label: "任务参数已校验",
      detail: `${generationInput.locale} · ${generationInput.sourceType}`
    });

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
    await updateProgress({
      step: "job:started",
      percent: 20,
      label: "生成任务已启动",
      detail: "正在准备研究、选题和关键词规划"
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
    await updateProgress({
      step: "research:running",
      percent: 28,
      label: "正在研究选题和关键词",
      detail: "读取 Shopify 上下文、热点趋势、内链和引用来源"
    });
    const pipelineResult: ContentPipelineResult | AgentContentPipelineResult =
      generationInput.generationConfig?.seoAgent?.enabled === false
        ? await runContentPipeline(generationInput, context.sourceContext)
        : await runAgentContentPipeline(generationInput, context.sourceContext);
    await updateProgress({
      step: "brief:completed",
      percent: 38,
      label: "选题和内容简报已完成",
      detail: pipelineResult.article.title
    });
    const agentPipelineResult = isAgentPipelineResult(pipelineResult) ? pipelineResult : null;
    const seoAgentRun = agentPipelineResult?.artifacts.agentRun ?? null;
    const aiProvider = resolveAiProvider(context.aiProvider);
    await updateProgress({
      step: "ai:provider_ready",
      percent: 42,
      label: "AI 配置已就绪",
      detail: aiProvider.safeMetadata.textModel
    });
    const aiResult = await generateArticleWithAi(aiProvider, generationInput, context.sourceContext, pipelineResult, updateProgress);
    const generated = aiResult.article;
    const status = generated.qualityPassed ? "ready_to_publish" : "quality_failed";
    await updateProgress({
      step: "article:saving",
      percent: 88,
      label: "正在保存文章和质量报告",
      detail: generated.title,
      status
    });
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
        imageAssets: aiResult.imageAssets?.map(serializeImageAssetDraft) ?? [],
        imageAsset: aiResult.imageAsset
          ? serializeImageAssetDraft(aiResult.imageAsset)
          : null,
        contentEngine: {
          artifacts: pipelineResult.artifacts,
          finalQuality: aiResult.quality,
          finalSeo: aiResult.seo,
          aiSearchReview: aiResult.aiSearchReview
        },
        seoAgent: seoAgentRun,
        queue: {
          bullJobId: job.id,
          correlationId: job.data.correlationId
        }
      }
    });
    articleId = article.id;
    await updateProgress({
      step: "article:saved",
      percent: 91,
      label: "文章已保存",
      detail: generated.qualityPassed ? "质量门槛已通过" : "文章需要人工复核",
      articleId: article.id,
      status
    });
    if (agentPipelineResult) {
      await persistSeoAgentRun({
        articleId: article.id,
        campaignId: context.campaign?.id ?? job.data.campaignId,
        organizationId: job.data.organizationId,
        storeId: job.data.storeId,
        locale: generationInput.locale,
        sourceType: generationInput.sourceType,
        sourceId: generationInput.sourceId,
        generationConfig: generationInput.generationConfig,
        pipelineResult: agentPipelineResult,
        qualityPassed: generated.qualityPassed,
        finalSeoScore: generated.seoScore,
        finalTrafficScore: aiResult.aiSearchReview?.final.score,
        publishJobId: publishJob.id
      });
    }
    await updateProgress({
      step: "agent:metadata_saved",
      percent: 94,
      label: "Agent 运行轨迹已保存",
      detail: seoAgentRun?.status ?? "standard pipeline",
      articleId: article.id,
      status
    });
    const generatedAssets = aiResult.imageAssets?.length ? aiResult.imageAssets : aiResult.imageAsset ? [aiResult.imageAsset] : [];
    for (const imageAsset of generatedAssets) {
      await persistGeneratedImageAsset({
        organizationId: job.data.organizationId,
        storeId: job.data.storeId,
        articleId: article.id,
        provider: context.aiProvider?.provider ?? null,
        asset: imageAsset
      });
    }
    await updateProgress({
      step: "assets:saved",
      percent: 96,
      label: "图片素材已保存",
      detail: `${generatedAssets.length} 个素材记录`,
      articleId: article.id,
      status
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
    await updateProgress({
      step: "article:generated",
      percent: 100,
      label: generated.qualityPassed ? "文章生成完成，可进入发布流程" : "文章生成完成，等待人工复核",
      detail: generated.title,
      articleId: article.id,
      status
    });
    await job.updateProgress({
      step: "article:generated",
      percent: 100,
      label: generated.qualityPassed ? "文章生成完成，可进入发布流程" : "文章生成完成，等待人工复核",
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

async function recordGenerationProgress(
  job: Job<BlogGenerationJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.blogGeneration>,
  campaignId: string | undefined,
  publishJobId: string | undefined,
  update: GenerationProgressUpdate
): Promise<void> {
  const progress = buildGenerationProgressPayload(update, job.id);

  await job.updateProgress(progress);

  await Promise.all([
    updateCampaignGenerationProgress(campaignId, progress),
    updatePublishJobGenerationProgress(publishJobId, progress)
  ]);
}

async function updateCampaignGenerationProgress(
  campaignId: string | undefined,
  progress: GenerationProgressPayload
): Promise<void> {
  if (!campaignId) return;

  const campaign = await prisma.blogCampaign.findUnique({
    where: { id: campaignId },
    select: { metadata: true }
  });
  if (!campaign) return;

  const metadata = isRecord(campaign.metadata) ? campaign.metadata : {};
  await prisma.blogCampaign.update({
    where: { id: campaignId },
    data: {
      metadata: toPrismaJson(mergeGenerationProgressPayload(metadata, progress))
    }
  });
}

async function updatePublishJobGenerationProgress(
  publishJobId: string | undefined,
  progress: GenerationProgressPayload
): Promise<void> {
  if (!publishJobId) return;

  const publishJob = await prisma.publishJob.findUnique({
    where: { id: publishJobId },
    select: { payload: true }
  });
  if (!publishJob) return;

  const payload = isRecord(publishJob.payload) ? publishJob.payload : {};
  await prisma.publishJob.update({
    where: { id: publishJobId },
    data: {
      payload: toPrismaJson(mergeGenerationProgressPayload(payload, progress))
    }
  });
}

export function buildGenerationProgressPayload(
  update: GenerationProgressUpdate,
  bullJobId?: string,
  updatedAt = new Date().toISOString()
): GenerationProgressPayload {
  return {
    step: update.step,
    label: update.label,
    percent: clampProgressPercent(update.percent),
    detail: update.detail,
    articleId: update.articleId,
    status: update.status,
    bullJobId,
    updatedAt
  };
}

export function mergeGenerationProgressPayload(
  container: unknown,
  progress: GenerationProgressPayload
): Record<string, unknown> {
  const base = isRecord(container) ? { ...container } : {};
  const previous = isRecord(base.generationProgress) ? (base.generationProgress as Record<string, unknown>) : undefined;
  if (!previous) {
    return {
      ...base,
      generationProgress: {
        ...progress,
        history: progress.history ?? [toProgressHistoryEntry(progress)]
      }
    };
  }

  const previousPercent = clampProgressPercent(numberValue(previous.percent) ?? 0);
  const nextPercent = clampProgressPercent(progress.percent);
  const canRegress = canProgressRegress(progress);
  if (previousPercent > nextPercent && !canRegress) {
    const staleUpdate = toProgressHistoryEntry(progress, true);
    return {
      ...base,
      generationProgress: {
        ...previous,
        updatedAt: progress.updatedAt,
        history: appendProgressHistory(seedProgressHistory(previous), staleUpdate),
        staleUpdate
      }
    };
  }

  return {
    ...base,
    generationProgress: {
      ...progress,
      previousStep: stringValue(previous.step),
      history: appendProgressHistory(seedProgressHistory(previous), toProgressHistoryEntry(progress))
    }
  };
}

export function clampProgressPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function canProgressRegress(progress: GenerationProgressPayload): boolean {
  const marker = `${progress.step} ${progress.status ?? ""}`.toLowerCase();
  return marker.includes("retry") || marker.includes("failed");
}

function appendProgressHistory(existing: unknown, next: GenerationProgressHistoryEntry): GenerationProgressHistoryEntry[] {
  const history = Array.isArray(existing)
    ? existing
        .filter(isRecord)
        .map((item) => ({
          step: stringValue(item.step) ?? "unknown",
          label: stringValue(item.label),
          percent: clampProgressPercent(numberValue(item.percent) ?? 0),
          status: stringValue(item.status),
          updatedAt: stringValue(item.updatedAt),
          stale: Boolean(item.stale)
        }))
    : [];
  const previousLast = history.at(-1);
  if (
    previousLast &&
    previousLast.step === next.step &&
    previousLast.percent === next.percent &&
    previousLast.status === next.status
  ) {
    return history.slice(-8);
  }
  return [...history, next].slice(-8);
}

function seedProgressHistory(previous: Record<string, unknown>): GenerationProgressHistoryEntry[] {
  if (Array.isArray(previous.history) && previous.history.length > 0) return previous.history as GenerationProgressHistoryEntry[];
  return [
    {
      step: stringValue(previous.step) ?? "unknown",
      label: stringValue(previous.label),
      percent: clampProgressPercent(numberValue(previous.percent) ?? 0),
      status: stringValue(previous.status),
      updatedAt: stringValue(previous.updatedAt)
    }
  ];
}

function toProgressHistoryEntry(
  progress: Pick<GenerationProgressPayload, "step" | "label" | "percent" | "status" | "updatedAt">,
  stale = false
): GenerationProgressHistoryEntry {
  return {
    step: progress.step,
    label: progress.label,
    percent: clampProgressPercent(progress.percent),
    status: progress.status,
    updatedAt: progress.updatedAt,
    stale
  };
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
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>,
  onProgress?: GenerationProgressCallback
): Promise<{
  article: GeneratedArticle;
  seo: Awaited<ReturnType<typeof defaultSeoScorer.score>>;
  quality: QualityGateResult & { aiSearchReview?: AiSearchReviewWorkflow; highScoreStructure?: HighScoreStructureReport };
  imageAsset?: ImageAssetDraft;
  imageAssets?: ImageAssetDraft[];
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
    timeoutMs: aiTextTimeoutMs()
  });
  await onProgress?.({
    step: "ai:drafting",
    percent: 48,
    label: "AI 正在撰写正文",
    detail: `${provider.textModel} · ${input.targetWordCount} words`
  });
  const result = await client.generateText({
    model: provider.textModel,
    temperature: provider.temperature,
    stream: aiTextStreamingEnabled(),
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
      "Preserve the SEO skeleton, but make the language read like a shopping recommendation guide: concrete buyer scenes, real hesitation, fit/skip judgment, and product-page checks.",
      "Internal links are pre-validated storefront URLs. Use only sourceContext.internalLinks for internal links; never invent a product, collection, article, blog, or store URL.",
      "Do not use reader-facing meta labels such as SEO, search intent, scoring, prompt, template, content strategy, or 'this article will'.",
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

  let finalArticle = enforceRequiredLinks(article.data, context);
  await onProgress?.({
    step: "ai:draft_completed",
    percent: 56,
    label: "正文初稿已生成",
    detail: finalArticle.title
  });
  let aiSearchReview = await runAiSearchReviewWorkflow(client, provider, finalArticle, input, context, pipelineResult, onProgress).catch((error) =>
    recoverAiSearchReviewFailure(error, input, "initial-review")
  );
  if (aiSearchReview.revisedArticle) {
    finalArticle = enforceRequiredLinks(aiSearchReview.revisedArticle, context);
  }
  await onProgress?.({
    step: "image:generating",
    percent: 76,
    label: "正在生成并插入配图",
    detail: `${input.generationConfig?.imageGeneration?.imageCount ?? 3} 张图片计划`
  });
  const imageAssets = await maybeGenerateArticleImages(provider, finalArticle, input, context);
  const generatedImageAssets = imageAssets.filter((asset) => asset.publicUrl);
  const primaryImageAsset = imageAssets[0];
  if (generatedImageAssets.length > 0) {
    finalArticle = {
      ...finalArticle,
      imagePrompt: primaryImageAsset?.prompt ?? finalArticle.imagePrompt,
      imageAlt: primaryImageAsset?.altText ?? finalArticle.imageAlt,
      bodyHtml: injectImageFigures(finalArticle.bodyHtml, generatedImageAssets, input.generationConfig)
    };
  } else if (primaryImageAsset?.prompt) {
    finalArticle = {
      ...finalArticle,
      imagePrompt: primaryImageAsset.prompt,
      imageAlt: primaryImageAsset.altText
    };
  }
  finalArticle = enforceRequiredLinks(finalArticle, context);
  aiSearchReview = await finalizeAiSearchReviewWorkflow(client, provider, aiSearchReview, finalArticle, input, context, pipelineResult, onProgress).catch(
    (error) => recoverAiSearchReviewFailure(error, input, "final-review", aiSearchReview)
  );
  if (aiSearchReview.revisedArticle) {
    finalArticle = enforceRequiredLinks(aiSearchReview.revisedArticle, context);
    const missingImages = generatedImageAssets.filter((asset) => asset.publicUrl && !finalArticle.bodyHtml.includes(asset.publicUrl));
    if (missingImages.length > 0) {
      finalArticle = {
        ...finalArticle,
        bodyHtml: injectImageFigures(finalArticle.bodyHtml, missingImages, input.generationConfig)
      };
    }
  }
  finalArticle = enforceRequiredLinks(finalArticle, context);

  const qualityInput = normalizeFinalQualityInput(input);
  await onProgress?.({
    step: "quality:finalizing",
    percent: 84,
    label: "正在计算最终 SEO 和质量门槛",
    detail: finalArticle.title
  });
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
    imageAsset: primaryImageAsset,
    imageAssets,
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
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>,
  onProgress?: GenerationProgressCallback
): Promise<{ workflow?: AiSearchReviewWorkflow; revisedArticle?: GeneratedArticle }> {
  const config = resolveAiSearchReviewConfig(input.generationConfig);
  if (!config.enabled) return {};

  await onProgress?.({
    step: "ai:reviewing",
    percent: 60,
    label: "AI 正在进行搜索流量评分",
    detail: `目标分 ${config.minTrafficScore}+`
  });
  const initial = applyHighScoreStructureReview(
    await reviewArticleForSearchTraffic(client, provider, article, input, context, pipelineResult, "initial"),
    evaluateHighScoreArticleStructure(article, input, context),
    input
  );
  let currentArticle = article;
  let currentReview = initial;
  let bestArticle = article;
  let bestReview = initial;
  const revisions: AiSearchRevisionPass[] = [];

  for (let pass = 1; pass <= config.maxRevisionPasses; pass += 1) {
    if (currentReview.score >= config.minTrafficScore) break;

    await onProgress?.({
      step: `ai:revision_${pass}`,
      percent: Math.min(72, 60 + pass * 4),
      label: `AI 正在第 ${pass} 次改稿`,
      detail: `当前评分 ${currentReview.score}，目标 ${config.minTrafficScore}+`
    });
    const revisedArticle = enforceRequiredLinks(
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
    if (revisedReview.score >= bestReview.score) {
      bestArticle = revisedArticle;
      bestReview = revisedReview;
    }
  }

  return {
    workflow: {
      enabled: true,
      minTrafficScore: config.minTrafficScore,
      maxRevisionPasses: config.maxRevisionPasses,
      initial,
      final: bestReview,
      revisions
    },
    revisedArticle: revisions.length > 0 && bestArticle !== article ? bestArticle : undefined
  };
}

async function finalizeAiSearchReviewWorkflow(
  client: ReturnType<typeof createOpenAICompatibleClient>,
  provider: ResolvedAiProvider,
  result: { workflow?: AiSearchReviewWorkflow; revisedArticle?: GeneratedArticle },
  finalArticle: GeneratedArticle,
  input: ParsedGenerationInput,
  context: ContentSourceContext,
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>,
  onProgress?: GenerationProgressCallback
): Promise<{ workflow?: AiSearchReviewWorkflow; revisedArticle?: GeneratedArticle }> {
  if (!result.workflow) return result;

  await onProgress?.({
    step: "ai:final_review",
    percent: 80,
    label: "AI 正在复核配图后的最终文章",
    detail: `目标分 ${result.workflow.minTrafficScore}+`
  });
  let currentArticle = finalArticle;
  let currentReview = applyHighScoreStructureReview(
    await reviewArticleForSearchTraffic(client, provider, currentArticle, input, context, pipelineResult, "final-saved-article"),
    evaluateHighScoreArticleStructure(currentArticle, input, context),
    input
  );
  let bestArticle = currentArticle;
  let bestReview = currentReview;
  const revisions = [...result.workflow.revisions];

  for (let pass = revisions.length + 1; pass <= result.workflow.maxRevisionPasses; pass += 1) {
    if (currentReview.score >= result.workflow.minTrafficScore) break;

    await onProgress?.({
      step: `ai:final_revision_${pass}`,
      percent: Math.min(84, 80 + pass * 2),
      label: `AI 正在最终改稿第 ${pass} 次`,
      detail: `当前评分 ${currentReview.score}，目标 ${result.workflow.minTrafficScore}+`
    });
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
    currentArticle = enforceRequiredLinks(revisedArticle, context);
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
    if (revisedReview.score >= bestReview.score) {
      bestArticle = currentArticle;
      bestReview = revisedReview;
    }
  }

  return {
    ...result,
    workflow: {
      ...result.workflow,
      final: bestReview,
      revisions
    },
    revisedArticle: bestArticle !== finalArticle ? bestArticle : result.revisedArticle
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
    stream: aiTextStreamingEnabled(),
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
            area: "title | intro | section | internal links | external citations | facts | FAQ | conversion",
            issue: "what is weak right now",
            concreteEdit: "the exact section, table, paragraph, link, or FAQ to add/change",
            acceptanceCheck: "how to verify the edit is complete"
          }
        ]
      }),
      "Score means likelihood to earn non-brand organic search traffic, not just keyword stuffing.",
      "Use 0-100 integers. Penalize generic buying-guide content, weak search intent, thin examples, unsupported claims, title formulas, missing internal links, missing external citations, weak product/category fit, and visible AI/SEO instruction-sheet language.",
      "Use this high-score contract as the scoring rubric. Do not give 82+ unless the article substantially satisfies it:",
      highScoreArticleContract(input, context).join("\n"),
      "Use localStructureReport as a hard sanity check. If it has failed checks, the score must stay below the minimum and the failed checks must become actionItems.",
      "Do not claim the article is truncated, missing FAQ, or missing a conclusion when article.metrics and localStructureReport show those elements are present. If bodyTextTruncated is false, treat bodyText as the complete article text.",
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
        externalReferences: externalReferenceCandidates(context).slice(0, 6).map(compactExternalReferenceCandidate),
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
    stream: aiTextStreamingEnabled(),
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
      "Preserve or add required external citations from sourceContext.externalReferences. Do not remove the reference section unless citations are disabled.",
      "Use only verified URLs from sourceContext.internalLinks for internal links. Remove or replace any internal product, collection, article, blog, or store URL that is not in that list.",
      "Treat revisionBrief and actionItems as a required checklist. Satisfy every acceptanceCheck that can be satisfied with the supplied evidence, and remove unrelated trend/news terms.",
      "Before returning, audit your own draft: if an actionItem asks for a section, table, FAQ, internal link, product fact box, comparison, or CTA, it must actually exist in bodyHtml.",
      "When score is low because the article is generic, restructure heavily instead of making small wording changes.",
      "Keep the SEO skeleton, but rewrite visible language as a shopping recommendation guide with real buyer scenes. Do not expose SEO, search-intent, scoring, prompt, template, or content-strategy labels to readers.",
      "Keep the article in the same locale. Do not invent product facts, prices, discounts, testimonials, rankings, medical/legal claims, or unsupported statistics.",
      "Use synced product options, variants, image context, SEO descriptions, and tags as facts. If important specs are missing, state that they are not confirmed and shift the angle to styling, gifting, cleaning, comparison, or shopper fit.",
      "If currentArticle already contains an image figure or generated image URL, preserve it unless it is broken or irrelevant.",
      "If currentArticle already contains multiple generated image figures, keep the useful ones and place them where they support the surrounding search intent.",
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
  const doctrine = buildCommercialSkillDoctrine(input.locale);
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
  const requiredExternalLinks = expectedExternalReferenceCount(context);
  const hasVariantOptions = Boolean(product?.options?.length || product?.variants?.length);
  const sourceLabel = product?.title ?? collection?.title ?? input.topic ?? input.primaryKeyword ?? "the selected topic";

  return [
    `High-score target: write for ${target}+ AI search traffic score; ${minimum} is only the minimum gate.`,
    `Primary source anchor: ${sourceLabel}. The article must feel built from this source, not from a reusable template.`,
    `Skill doctrine ${doctrine.version}: apply lessons from ${doctrine.sources.map((source) => source.name).join(", ")}.`,
    `Required modules: ${doctrine.requiredArticleModules.join(" | ")}.`,
    `Anti-slop rules: ${doctrine.antiSlopRules.join(" ")}`,
    `Scoring rubric: ${doctrine.scoringRubric.map((item) => `${item.dimension} ${item.weight}% - ${item.passSignal}`).join(" ; ")}`,
    "Hard requirements:",
    "- Reader tone: preserve the SEO skeleton, but every visible heading and paragraph must read like a shopping recommendation guide, not an AI/SEO instruction sheet.",
    "- Buyer scenes: include concrete use moments such as commute, gift, daily outfit, desk setup, travel, replacement, or care routine when they fit the product/category.",
    "- Banned reader-facing labels: do not show 'SEO', 'search intent', 'scoring', 'prompt', 'template', 'content strategy', 'this article will', or similar internal workflow language.",
    "- Title: specific search intent + clear differentiator. Avoid formula starts like 'How to Choose', 'Guide', 'Best', or '[keyword]: ...' unless the exact query demands it.",
    "- Intro: within the first 120 words, state who the article is for, the concrete buying/search question, the verified product/category anchor, and the decision the reader will be able to make.",
    "- Direct answer: include a 40-60 word answer-first block near the top that could stand alone in a featured snippet or AI answer.",
    "- Search intent: map the H2s to clear intent stages: quick answer, verified facts, comparison/decision, practical use, internal next step, FAQ.",
    "- External citations: use approved external references to support search demand, trend context, or factual background. Never invent source URLs.",
    "- Keyword evidence: use primary, secondary, and long-tail terms because they match the topic and buyer intent; avoid forcing unrelated trend/news keywords.",
    "- Evidence: include a compact verified-facts section or table using only synced product/category facts. Also include a 'not confirmed' note for important unknowns instead of guessing.",
    hasVariantOptions
      ? "- Decision depth: include a variant/finish/fit decision table using synced options or variants, with 'best for' guidance for each relevant option."
      : "- Decision depth: include a concrete comparison table or decision matrix based on shopper fit, use case, styling, gifting, care, or category tradeoffs.",
    "- Product/image specificity: reference visible product-image observations only when supported by supplied images or metadata; avoid generic material/protection claims.",
    requiredInternalLinks > 0
      ? `- Internal links: include at least ${requiredInternalLinks} contextual internal links from the verified sourceContext.internalLinks list, with natural anchor text and a reason in the surrounding sentence.`
      : "- Internal links: if no verified candidates are supplied, do not invent links.",
    requiredExternalLinks > 0
      ? `- External references: include at least ${requiredExternalLinks} cited external link(s) from sourceContext.externalReferences, with rel="nofollow noopener noreferrer" and a short reason.`
      : "- External references: if references are disabled, do not add fabricated citations.",
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
  const requiredExternalLinks = expectedExternalReferenceCount(context);
  const internalLinks = extractInternalArticleLinks(html, context).size;
  const externalLinks = extractExternalCitationUrls(html, context).size;
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
      "external-citations",
      "Required external cited references",
      externalLinks >= requiredExternalLinks,
      `Add ${Math.max(0, requiredExternalLinks - externalLinks)} approved external citation link(s); detected ${externalLinks}, expected ${requiredExternalLinks}.`
    ),
    structureCheck(
      "search-intent-coverage",
      "Search intent stages are visibly covered",
      hasSearchIntentCoverage(html, text, locale),
      "Add explicit quick answer, evidence/facts, decision guidance, practical use, references, and FAQ coverage."
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

function hasSearchIntentCoverage(html: string, text: string, locale: SupportedLocale): boolean {
  if (/search intent coverage|搜索意图覆盖|先帮你判断适不适合|Start here: is it a good fit/i.test(html)) return true;
  const hasAnswer = hasAnswerFirstBlock(html, text, locale);
  const hasFacts = hasVerifiedFactsSection(html, text, locale);
  const hasDecision = hasDecisionTable(html, text, locale) || hasChooseSkipGuidance(text, locale);
  const hasReferences =
    locale === "zh-CN" ? /(参考来源|外部参考|来源|引用)/i.test(text) : /(external references|references|sources|cited)/i.test(text);
  const hasFaq = countFaqQuestions(html, text, locale) >= 3;
  return [hasAnswer, hasFacts, hasDecision, hasReferences, hasFaq].filter(Boolean).length >= 4;
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
  const rawScore = clampPercent(numberValue(record.score) ?? averageReviewDimensions(record));
  const actionItems = normalizeAiSearchActionItems(record.actionItems, record.recommendations, record.revisionBrief).slice(0, 10);
  const dimensionAverage = averageReviewDimensions(record);
  const missingActionItemCap = rawScore < minTrafficScore && actionItems.length < 5 ? minTrafficScore - 1 : rawScore;
  const dimensionCap = dimensionAverage > 0 ? Math.min(missingActionItemCap, Math.max(dimensionAverage + 8, minTrafficScore - 18)) : missingActionItemCap;
  const score = clampPercent(dimensionCap);

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
    actionItems
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
  const bodyText = stripHtmlForReview(article.bodyHtml);
  const bodyTextLimit = 22000;
  const bodyHtmlLimit = 9000;
  return {
    title: article.title,
    handle: article.handle,
    summary: article.summary,
    primaryKeyword: article.primaryKeyword,
    secondaryKeywords: article.secondaryKeywords,
    tags: article.tags,
    locale: article.locale,
    metrics: {
      textChars: bodyText.length,
      htmlChars: article.bodyHtml.length,
      h2: matchCount(article.bodyHtml, /<h2\b/gi),
      h3: matchCount(article.bodyHtml, /<h3\b/gi),
      tables: matchCount(article.bodyHtml, /<table\b/gi),
      links: matchCount(article.bodyHtml, /<a\b/gi),
      images: matchCount(article.bodyHtml, /<img\b/gi),
      questions: matchCount(bodyText, /[?？]/g)
    },
    bodyText: trimForPrompt(bodyText, bodyTextLimit),
    bodyTextTruncated: bodyText.length > bodyTextLimit,
    bodyHtmlPreview: trimForPrompt(article.bodyHtml, bodyHtmlLimit),
    bodyHtmlPreviewTruncated: article.bodyHtml.length > bodyHtmlLimit
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
    storefrontHost: context.storefrontHost,
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
    externalReferences: externalReferenceCandidates(context).slice(0, 6).map(compactExternalReferenceCandidate),
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

function compactExternalReferenceCandidate(reference: ExternalReferenceCandidate): ExternalReferenceCandidate {
  return {
    ...reference,
    title: trimForPrompt(reference.title, 220),
    source: trimForPrompt(reference.source, 120),
    snippet: reference.snippet ? trimForPrompt(reference.snippet, 360) : undefined,
    reason: reference.reason ? trimForPrompt(reference.reason, 180) : undefined
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

function matchCount(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
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

function enforceRequiredLinks(article: GeneratedArticle, context: ContentSourceContext): GeneratedArticle {
  const sanitized = {
    ...article,
    bodyHtml: sanitizeArticleInternalLinks(article.bodyHtml, context)
  };
  return enforceExternalCitations(enforceInternalLinks(sanitized, context), context);
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

function enforceExternalCitations(article: GeneratedArticle, context: ContentSourceContext): GeneratedArticle {
  const requiredCount = expectedExternalReferenceCount(context);
  if (requiredCount <= 0) return article;

  const references = externalReferenceCandidates(context);
  if (references.length === 0) return article;

  const existingUrls = extractExternalCitationUrls(article.bodyHtml, context);
  const neededCount = Math.max(0, requiredCount - existingUrls.size);
  if (neededCount === 0) return article;
  const missing = references.filter((reference) => !existingUrls.has(normalizeExternalReferenceUrl(reference.url))).slice(0, neededCount);
  if (missing.length === 0) return article;

  const list = renderExternalReferenceItems(missing);
  const bodyWithUpdatedReferences = appendLinksToReferenceSection(article.bodyHtml, list);
  if (bodyWithUpdatedReferences !== article.bodyHtml) {
    return {
      ...article,
      bodyHtml: bodyWithUpdatedReferences
    };
  }

  const heading = article.locale === "zh-CN" ? "参考来源" : "External references";
  const note =
    article.locale === "zh-CN"
      ? "这些来源用于交叉核对趋势、搜索需求或背景信息；商品细节仍以店铺同步数据为准。"
      : "These references support trend, search demand, or background context; product details still come from synced store data.";

  return {
    ...article,
    bodyHtml: `${article.bodyHtml}<section><h2>${heading}</h2><p>${escapeHtml(note)}</p><ul>${list}</ul></section>`
  };
}

function renderExternalReferenceItems(references: ExternalReferenceCandidate[]): string {
  return references
    .map((reference) => {
      const label = `${reference.title}${reference.source ? ` · ${reference.source}` : ""}`;
      const reason = reference.reason ?? reference.snippet;
      return `<li><a href="${escapeHtml(reference.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(label)}</a>${reason ? ` <span>${escapeHtml(reason)}</span>` : ""}</li>`;
    })
    .join("");
}

function appendLinksToReferenceSection(bodyHtml: string, listItems: string): string {
  const pattern =
    /(<section\b[^>]*>\s*<h2\b[^>]*>\s*(?:参考来源|外部参考|External references|References|Sources)\s*<\/h2>[\s\S]*?<ul\b[^>]*>)([\s\S]*?)(<\/ul>\s*<\/section>)/i;
  if (!pattern.test(bodyHtml)) return bodyHtml;
  return bodyHtml.replace(pattern, (_match, before: string, currentItems: string, after: string) => `${before}${currentItems}${listItems}${after}`);
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

function extractInternalArticleLinks(bodyHtml: string, context: ContentSourceContext): Set<string> {
  const allowedInternalUrls = new Set(
    mixInternalLinkCandidates([context.internalLinks ?? []], context.generationConfig?.internalLinks?.maxLinks ?? 4).map((link) =>
      normalizeInternalLinkUrl(link.url)
    )
  );
  const urls = extractArticleLinkUrls(bodyHtml);
  if (allowedInternalUrls.size === 0) return urls;
  return new Set(Array.from(urls).filter((url) => allowedInternalUrls.has(url)));
}

function extractExternalCitationUrls(bodyHtml: string, context: ContentSourceContext): Set<string> {
  const urls = new Set<string>();
  const approved = new Set(externalReferenceCandidates(context).map((reference) => normalizeExternalReferenceUrl(reference.url)));
  const internal = new Set((context.internalLinks ?? []).map((link) => normalizeInternalLinkUrl(link.url)));
  const pattern = /<a\b([^>]*)\shref=["']([^"']+)["']([^>]*)>/gi;
  for (const match of bodyHtml.matchAll(pattern)) {
    const href = match[2] ?? "";
    if (!isHttpUrl(href)) continue;
    const externalKey = normalizeExternalReferenceUrl(href);
    const internalKey = normalizeInternalLinkUrl(href);
    const attrs = `${match[1] ?? ""} ${match[3] ?? ""}`.toLowerCase();
    if (internal.has(internalKey)) continue;
    if (approved.has(externalKey) || attrs.includes("nofollow") || attrs.includes("noopener")) {
      urls.add(externalKey);
    }
  }
  return urls;
}

function externalReferenceCandidates(context: ContentSourceContext): ExternalReferenceCandidate[] {
  if (context.generationConfig?.externalReferences?.enabled === false) return [];

  const maxLinks = context.generationConfig?.externalReferences?.maxLinks ?? 3;
  const query =
    firstNonBlank(
      context.topic,
      context.seedKeywords?.[0],
      context.product?.productType,
      context.collection?.title,
      context.product?.title,
      "Shopify ecommerce"
    ) ?? "Shopify ecommerce";
  const trendReferences = relevantTrendSignals(context)
    .filter((signal) => Boolean(signal.url))
    .map((signal) => ({
      title: signal.title,
      url: signal.url as string,
      source: signal.source || "trend feed",
      snippet: signal.summary,
      publishedAt: signal.publishedAt,
      reason: "trend/news context for this article angle",
      relevanceScore: signal.relevanceScore
    }));
  const fallback: ExternalReferenceCandidate = {
    title: `Google Trends for ${query}`,
    url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
    source: "Google Trends",
    reason: "search demand cross-check",
    relevanceScore: 1
  };

  const seen = new Set<string>();
  const output: ExternalReferenceCandidate[] = [];
  for (const reference of [...(context.externalReferences ?? []), ...trendReferences, fallback]) {
    if (!isHttpUrl(reference.url)) continue;
    const key = normalizeExternalReferenceUrl(reference.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...reference,
      title: reference.title || reference.source || reference.url,
      source: reference.source || "External source"
    });
    if (output.length >= maxLinks) break;
  }
  return output;
}

function expectedExternalReferenceCount(context: ContentSourceContext): number {
  const config = context.generationConfig?.externalReferences;
  if (config?.enabled === false || config?.requireEveryArticle === false) return 0;
  const available = externalReferenceCandidates(context).length;
  const minLinks = config?.minLinks ?? 1;
  return Math.min(Math.max(1, minLinks), available);
}

function normalizeExternalReferenceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.hostname.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function maybeGenerateArticleImages(
  provider: ResolvedAiProvider,
  article: GeneratedArticle,
  input: ParsedGenerationInput,
  context: ContentSourceContext
): Promise<ImageAssetDraft[]> {
  if (input.generationConfig?.imageGeneration?.enabled === false) return [];

  const referenceLimit =
    input.generationConfig?.imageGeneration?.referenceImageLimit ??
    input.generationConfig?.productImageReference?.maxImages ??
    6;
  const referenceImageUrls = uniqueStrings(context.imageReferences?.map((item) => item.url) ?? []).slice(0, referenceLimit);
  const plans = buildImagePromptPlans(article, input, context, referenceImageUrls);

  if (!provider.imageModel) {
    return plans.map((plan) => ({
      ...plan,
      error: "AI image model is not configured.",
      referenceImageUrls
    }));
  }

  const client = createOpenAICompatibleClient({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.imageModel,
    timeoutMs: aiImageTimeoutMs()
  });
  const assets: ImageAssetDraft[] = [];

  for (const plan of plans) {
    const prompt = composeImagePrompt(plan.prompt, context, referenceImageUrls);
    const assetBase = {
      ...plan,
      prompt,
      referenceImageUrls
    };

    try {
      const image = await client.generateImage({
        model: provider.imageModel,
        prompt,
        size: "1536x864",
        responseFormat: "url",
        referenceImageUrls,
        extraBody: referenceImageUrls.length
          ? {
              reference_images: referenceImageUrls,
              fusion_mode: input.generationConfig?.imageGeneration?.fusionMode,
              image_index: plan.index,
              image_role: plan.placement
            }
          : undefined
      });

      assets.push(imageToAssetDraft(image, assetBase));
    } catch (error) {
      assets.push({
        ...assetBase,
        error: getErrorMessage(error)
      });
    }
  }

  return assets;
}

function buildImagePromptPlans(
  article: GeneratedArticle,
  input: ParsedGenerationInput,
  context: ContentSourceContext,
  referenceImageUrls: string[]
): ImageAssetDraft[] {
  const count = Math.max(1, Math.min(4, Math.round(input.generationConfig?.imageGeneration?.imageCount ?? 3)));
  const placement = input.generationConfig?.imageGeneration?.placement ?? "inline";
  const basePrompt = article.imagePrompt ?? buildFallbackImagePrompt(article, context);
  const topic = context.topic ?? input.topic ?? article.primaryKeyword;
  const productOrCategory = context.product?.title ?? context.collection?.title ?? article.primaryKeyword;
  const locale = article.locale;
  const variants =
    locale === "zh-CN"
      ? [
          "首图：真实电商编辑场景，能一眼看懂搜索主题和品类使用场景，不要产品白底抠图",
          "正文图：展示用户正在比较、搭配或检查细节的生活方式场景，画面自然不摆拍",
          "正文图：覆盖 FAQ 或购买前检查意图，包含环境、尺度、细节和真实使用线索",
          "正文图：趋势/场景化概念图，强调用户问题而不是单独展示商品"
        ]
      : [
          "hero image: realistic ecommerce editorial scene that makes the search topic and category use case immediately clear, not a white-background product cutout",
          "inline image: lifestyle moment where a shopper compares, styles, or checks details in a natural setting",
          "inline image: FAQ or pre-purchase-check scene with environment, scale, detail, and real-use cues",
          "inline image: trend or scenario-led concept image focused on the user's question rather than a standalone product shot"
        ];

  return Array.from({ length: count }, (_, index) => {
    const planPlacement: ImageAssetDraft["placement"] = placement === "featured" || (placement === "both" && index === 0) ? "featured" : "inline";
    const variant = variants[index % variants.length];
    return {
      prompt: [
        basePrompt,
        `Image ${index + 1}/${count}: ${variant}`,
        `Article topic: ${topic}`,
        `Product/category anchor: ${productOrCategory}`,
        referenceImageUrls.length
          ? "Use supplied product images only as optional visual grounding; the final image should be a complete editorial scene, not the raw product photo pasted into the article."
          : "No product reference image is required; create a complete editorial scene that satisfies search intent.",
        "Photorealistic, natural light, clean composition, Shopify blog ready, no watermark, no fake UI text, no brand logos that are not supplied."
      ]
        .filter(Boolean)
        .join("; "),
      altText:
        index === 0
          ? article.imageAlt ?? article.title
          : locale === "zh-CN"
            ? `${article.primaryKeyword}正文场景图 ${index + 1}`
            : `${article.primaryKeyword} ${planPlacement === "featured" ? "feature" : "inline"} scene ${index + 1}`,
      placement: planPlacement,
      index,
      referenceImageUrls
    };
  });
}

function imageToAssetDraft(
  image: GenerateImageResult,
  draft: ImageAssetDraft
): ImageAssetDraft {
  const dataUrl = image.b64Json ? `data:image/png;base64,${image.b64Json}` : undefined;

  return {
    ...draft,
    publicUrl: image.url,
    sourceUrl: image.url ?? dataUrl,
    providerModel: image.model,
    raw: {
      revisedPrompt: image.revisedPrompt
    }
  };
}

function serializeImageAssetDraft(asset: ImageAssetDraft) {
  return {
    prompt: asset.prompt,
    altText: asset.altText,
    placement: asset.placement,
    index: asset.index,
    publicUrl: asset.publicUrl,
    sourceUrl: asset.sourceUrl,
    providerModel: asset.providerModel,
    error: asset.error,
    referenceImageUrls: asset.referenceImageUrls,
    raw: asset.raw
  };
}

function injectImageFigures(bodyHtml: string, assets: ImageAssetDraft[], generationConfig?: GenerationConfig) {
  let nextBody = bodyHtml;
  const orderedAssets = assets
    .filter((asset) => asset.publicUrl && !nextBody.includes(asset.publicUrl))
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));

  for (const asset of orderedAssets) {
    const imageUrl = asset.publicUrl;
    if (!imageUrl) continue;
    const figure = `<figure><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(asset.altText)}" /></figure>`;
    const placement = asset.placement ?? generationConfig?.imageGeneration?.placement ?? "inline";
    if (placement === "featured") {
      nextBody = `${figure}${nextBody}`;
      continue;
    }

    nextBody = insertFigureAfterSection(nextBody, figure, asset.index ?? 1);
  }

  return nextBody;
}

function insertFigureAfterSection(bodyHtml: string, figure: string, index: number) {
  const paragraphEnd = bodyHtml.indexOf("</p>");
  if (paragraphEnd >= 0 && index <= 1) {
    return `${bodyHtml.slice(0, paragraphEnd + 4)}${figure}${bodyHtml.slice(paragraphEnd + 4)}`;
  }

  const sectionMatches = Array.from(bodyHtml.matchAll(/<\/section>/gi));
  const sectionIndex = Math.max(0, Math.min(sectionMatches.length - 1, index - 1));
  const match = sectionMatches[sectionIndex];
  if (match?.index !== undefined) {
    const insertionPoint = match.index + match[0].length;
    return `${bodyHtml.slice(0, insertionPoint)}${figure}${bodyHtml.slice(insertionPoint)}`;
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
      type: input.asset.placement === "featured" ? "featured_image" : "inline_image",
      status: input.asset.error ? "failed" : input.asset.publicUrl || input.asset.sourceUrl ? "generated" : "requested",
      provider: isAiProvider(input.provider) ? input.provider : undefined,
      prompt: input.asset.prompt,
      altText: input.asset.altText,
      sourceUrl: input.asset.sourceUrl,
      publicUrl: input.asset.publicUrl,
      metadata: toPrismaJson({
        providerModel: input.asset.providerModel,
        placement: input.asset.placement,
        index: input.asset.index,
        referenceImageUrls: input.asset.referenceImageUrls,
        raw: input.asset.raw,
        error: input.asset.error
      })
    }
  });
}

function isAiProvider(value: string | null): value is "openai" | "compatible" | "custom" {
  return value === "openai" || value === "compatible" || value === "custom";
}

function aiTextTimeoutMs(): number {
  return parseIntegerEnv("AI_TEXT_TIMEOUT_MS", parseIntegerEnv("AI_REQUEST_TIMEOUT_MS", 300000));
}

function aiImageTimeoutMs(): number {
  return parseIntegerEnv("AI_IMAGE_TIMEOUT_MS", parseIntegerEnv("AI_REQUEST_TIMEOUT_MS", 240000));
}

function aiTextStreamingEnabled(): boolean {
  return process.env.AI_TEXT_STREAMING?.toLowerCase() !== "false";
}

function internalLinkValidationTimeoutMs(): number {
  return parseIntegerEnv("INTERNAL_LINK_VALIDATION_TIMEOUT_MS", 4500);
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
    const storefrontHost = await resolveStorefrontHostForStore(store, "publish", client);
    await job.updateProgress({ step: "article:uploading_images", articleId: article.id });
    const preparedArticle = await prepareArticleForShopifyPublish({
      client,
      article,
      organizationId: job.data.organizationId,
      storeId: store.id,
      authorName: publishAuthorName(store),
      storefrontHost
    });
    const published = await publishToShopify(client, preparedArticle.article, shopifyBlogId, {
      authorName: preparedArticle.authorName,
      coverImage: preparedArticle.coverImage
    });
    if (published.isPublished === false) {
      throw domainError(
        "SHOPIFY_ARTICLE_NOT_PUBLISHED",
        "Shopify accepted the article but returned it as not published. Check blog permissions, publication settings, and article visibility.",
        {
          retryable: false,
          details: {
            shopifyArticleId: published.id,
            shopifyBlogId,
            handle: published.handle
          }
        }
      );
    }
    const publishedAt = dateValue(published.publishedAt) ?? new Date();

    await prisma.blogArticle.update({
      where: { id: article.id },
      data: {
        status: "published",
        shopifyBlogId,
        shopifyArticleId: published.id,
        handle: published.handle ?? article.handle,
        title: published.title ?? article.title,
        canonicalUrl: buildCanonicalUrl(storefrontHost, published),
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

async function resolveStorefrontHostForStore(
  store: {
    id: string;
    myshopifyDomain: string;
    metadata: unknown;
    apiVersion: string;
    adminAccessTokenEncrypted: string | null;
    adminAccessTokenExpiresAt: Date | null;
    shopifyClientId: string | null;
    shopifyClientSecretEncrypted: string | null;
    scopes: string[];
    status: string;
  },
  action: "sync" | "publish",
  client?: ShopifyGraphQLClient
): Promise<string> {
  const metadata = isRecord(store.metadata) ? store.metadata : {};

  try {
    const shopifyClient =
      client ??
      createShopifyGraphQLClient({
        shopDomain: store.myshopifyDomain,
        accessToken: await resolveFreshStoreAccessToken(store, action),
        apiVersion: store.apiVersion
      });
    const shop = await getShopInfo(shopifyClient);
    const domainMetadata = shopDomainMetadata(shop);
    await prisma.shopifyStore.update({
      where: { id: store.id },
      data: {
        name: shop.name || undefined,
        shopifyShopGid: shop.id,
        shopOwnerEmail: shop.email ?? undefined,
        currencyCode: shop.currencyCode ?? undefined,
        metadata: toPrismaJson({
          ...metadata,
          ...domainMetadata
        })
      }
    });

    return storefrontHostFromMetadata(domainMetadata) ?? store.myshopifyDomain;
  } catch {
    return storefrontHostFromMetadata(metadata) ?? store.myshopifyDomain;
  }
}

function storefrontHostFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return (
    normalizeStorefrontHost(metadata.primaryDomainHost) ??
    hostFromUrl(typeof metadata.primaryDomainUrl === "string" ? metadata.primaryDomainUrl : undefined) ??
    hostFromUrl(typeof metadata.shopUrl === "string" ? metadata.shopUrl : undefined)
  );
}

function shopDomainMetadata(shop: ShopifyShopInfo): Record<string, unknown> {
  const primaryDomainHost = normalizeStorefrontHost(shop.primaryDomain?.host);
  return {
    primaryDomainHost,
    primaryDomainUrl: primaryDomainHost ? `https://${primaryDomainHost}` : normalizeStorefrontUrl(shop.url),
    shopUrl: normalizeStorefrontUrl(shop.url)
  };
}

function normalizeStorefrontUrl(value: string | null | undefined): string | undefined {
  const host = hostFromUrl(value) ?? normalizeStorefrontHost(value);
  return host ? `https://${host}` : undefined;
}

function hostFromUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return normalizeStorefrontHost(new URL(value).hostname);
  } catch {
    return undefined;
  }
}

function normalizeStorefrontHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const host = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(host)) return undefined;
  return host;
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

function publishAuthorName(store: { name: string | null; myshopifyDomain: string }): string {
  const name = store.name?.trim();
  if (name) return name;
  return store.myshopifyDomain.replace(/\.myshopify\.com$/i, "");
}

async function prepareArticleForShopifyPublish(input: {
  client: ShopifyGraphQLClient;
  article: PublishableArticleRow & {
    id: string;
    organizationId: string;
    storeId: string;
    generationMetadata: unknown;
  };
  organizationId: string;
  storeId: string;
  authorName: string;
  storefrontHost: string;
}): Promise<{ article: PublishableArticleRow; coverImage?: ShopifyArticleImageInput; authorName: string }> {
  const bodyHtml = input.article.bodyHtml ?? "";
  const assets = await prisma.generatedAsset.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      articleId: input.article.id,
      status: { in: ["generated", "uploaded"] }
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }]
  });

  const assetUrls = assets
    .flatMap((asset) => {
      if (isPublicHttpUrl(asset.publicUrl) && isShopifyHostedImage(asset.publicUrl, input.storefrontHost, input.client.shopDomain)) {
        return [asset.publicUrl];
      }
      return [asset.publicUrl, asset.sourceUrl];
    })
    .filter(isPublicHttpUrl);
  const bodyUrls = extractImageSources(bodyHtml).filter(isPublicHttpUrl);
  const uploadTargets = uniqueStrings([...bodyUrls, ...assetUrls]);
  const uploaded: Array<{
    originalUrl: string;
    uploaded: ShopifyUploadedImage;
    altText?: string | null;
    assetId?: string;
  }> = [];
  const skippedImageUploads: Array<{
    originalUrl: string;
    reason: string;
    assetId?: string;
  }> = [];

  for (const originalUrl of uploadTargets) {
    if (isShopifyHostedImage(originalUrl, input.storefrontHost, input.client.shopDomain)) continue;
    const matchingAsset = assets.find((asset) => asset.publicUrl === originalUrl || asset.sourceUrl === originalUrl);
    let uploadedImage: ShopifyUploadedImage;
    try {
      uploadedImage = await uploadImageFile(input.client, {
        originalSource: originalUrl,
        alt: matchingAsset?.altText ?? input.article.title ?? input.authorName,
        filename: shopifyImageFilename(input.article.handle ?? input.article.id, originalUrl)
      });
    } catch (error) {
      if (input.article.shopifyArticleId && isPendingShopifyImageUploadError(error)) {
        skippedImageUploads.push({
          originalUrl,
          reason: getErrorMessage(error),
          assetId: matchingAsset?.id
        });
        continue;
      }
      throw error;
    }
    uploaded.push({
      originalUrl,
      uploaded: uploadedImage,
      altText: matchingAsset?.altText,
      assetId: matchingAsset?.id
    });
  }

  const urlMap = new Map(uploaded.map((item) => [item.originalUrl, item.uploaded.url]));
  const nextBodyHtml = rewriteImageSources(bodyHtml, urlMap);
  const firstUploadedBodyImage = extractImageSources(nextBodyHtml).find((url) => isShopifyHostedImage(url, input.storefrontHost, input.client.shopDomain));
  const firstUploadedAssetImage = assetUrls.find((url) => isShopifyHostedImage(url, input.storefrontHost, input.client.shopDomain));
  const preferredCover =
    uploaded.find((item) => assets.find((asset) => asset.id === item.assetId)?.type === "featured_image") ??
    uploaded[0];
  const coverUrl = preferredCover?.uploaded.url ?? firstUploadedBodyImage ?? firstUploadedAssetImage;
  const coverImage = coverUrl
    ? {
        url: coverUrl,
        altText: preferredCover?.altText ?? input.article.title ?? input.authorName
      }
    : undefined;

  if (nextBodyHtml !== bodyHtml || uploaded.length > 0 || skippedImageUploads.length > 0) {
    const metadata = isRecord(input.article.generationMetadata) ? input.article.generationMetadata : {};
    await prisma.blogArticle.update({
      where: { id: input.article.id },
      data: {
        bodyHtml: nextBodyHtml,
        generationMetadata: toPrismaJson({
          ...metadata,
          shopifyPublishAssets: {
            uploadedAt: new Date().toISOString(),
            authorName: input.authorName,
            coverImage,
            images: uploaded.map((item) => ({
              assetId: item.assetId,
              originalUrl: item.originalUrl,
              shopifyFileId: item.uploaded.id,
              shopifyUrl: item.uploaded.url,
              fileStatus: item.uploaded.fileStatus
            })),
            skippedImages: skippedImageUploads
          }
        })
      }
    });

    await Promise.all(
      uploaded
        .filter((item) => item.assetId)
        .map((item) => {
          const existingAsset = assets.find((asset) => asset.id === item.assetId);
          const metadata = isRecord(existingAsset?.metadata) ? existingAsset.metadata : {};
          return prisma.generatedAsset.update({
            where: { id: item.assetId! },
            data: {
              status: "uploaded",
              sourceUrl: existingAsset?.sourceUrl ?? item.originalUrl,
              publicUrl: item.uploaded.url,
              width: item.uploaded.width ?? undefined,
              height: item.uploaded.height ?? undefined,
              metadata: toPrismaJson({
                ...metadata,
                shopifyFileId: item.uploaded.id,
                shopifyFileStatus: item.uploaded.fileStatus,
                originalProviderUrl: item.originalUrl,
                uploadedAt: new Date().toISOString()
              })
            }
          });
        })
    );
  }

  return {
    article: {
      ...input.article,
      bodyHtml: nextBodyHtml,
      generationMetadata: undefined
    },
    coverImage,
    authorName: input.authorName
  };
}

function extractImageSources(bodyHtml: string): string[] {
  const urls: string[] = [];
  for (const match of bodyHtml.matchAll(/<img\b[^>]*\bsrc=(["'])(.*?)\1/gi)) {
    const url = decodeHtmlAttribute(match[2] ?? "").trim();
    if (url) urls.push(url);
  }
  for (const match of bodyHtml.matchAll(/<img\b[^>]*\bsrcset=(["'])(.*?)\1/gi)) {
    urls.push(...parseSrcsetUrls(decodeHtmlAttribute(match[2] ?? "")));
  }
  return uniqueStrings(urls);
}

function rewriteImageSources(bodyHtml: string, urlMap: Map<string, string>): string {
  if (urlMap.size === 0) return bodyHtml;
  return bodyHtml
    .replace(/(<img\b[^>]*\bsrc=)(["'])(.*?)\2/gi, (match, prefix: string, quote: string, src: string) => {
      const decoded = decodeHtmlAttribute(src).trim();
      const nextUrl = urlMap.get(decoded);
      if (!nextUrl) return match;
      return `${prefix}${quote}${escapeHtmlAttribute(nextUrl)}${quote}`;
    })
    .replace(/(<img\b[^>]*\bsrcset=)(["'])(.*?)\2/gi, (match, prefix: string, quote: string, srcset: string) => {
      const nextSrcset = rewriteSrcset(decodeHtmlAttribute(srcset), urlMap);
      if (nextSrcset === decodeHtmlAttribute(srcset)) return match;
      return `${prefix}${quote}${escapeHtmlAttribute(nextSrcset)}${quote}`;
    });
}

function parseSrcsetUrls(srcset: string): string[] {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function rewriteSrcset(srcset: string, urlMap: Map<string, string>): string {
  return srcset
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      const [url, ...descriptors] = trimmed.split(/\s+/);
      const nextUrl = urlMap.get(url ?? "");
      return [nextUrl ?? url, ...descriptors].filter(Boolean).join(" ");
    })
    .join(", ");
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function isPublicHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function isPendingShopifyImageUploadError(error: unknown): boolean {
  return error instanceof Error && /did not return a hosted image URL yet/i.test(error.message);
}

function isShopifyHostedImage(url: string, storefrontHost: string, shopDomain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const storefront = storefrontHost.toLowerCase();
    const shop = shopDomain.toLowerCase();
    return host === storefront || host === shop || host.endsWith(".myshopify.com") || host.includes("cdn.shopify.com") || host.includes("shopifycdn.net");
  } catch {
    return false;
  }
}

function shopifyImageFilename(handleOrId: string, url: string): string {
  const ext = imageExtensionFromUrl(url) ?? "jpg";
  return `${compactHandleIdentity(handleOrId) ?? "blog-image"}-${hashString(url).toString(36).slice(0, 8)}.${ext}`;
}

function imageExtensionFromUrl(value: string): string | null {
  try {
    const pathname = new URL(value).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext && /^(png|jpe?g|webp|gif|avif)$/.test(ext)) return ext === "jpeg" ? "jpg" : ext;
  } catch {
    return null;
  }
  return null;
}

function trimForShopifySeoTitle(value: string): string {
  return trimForDb(stripHtmlForReview(value).replace(/\s+/g, " ").trim(), 70);
}

function trimForShopifySeoDescription(value: string): string {
  return trimForDb(stripHtmlForReview(value).replace(/\s+/g, " ").trim(), 320);
}

async function recordGenerationFailure(
  job: Job<BlogGenerationJobData, WorkerJobResult, typeof BLOG_GENERATION_JOB_NAMES.blogGeneration>,
  error: unknown,
  publishJobId?: string,
  articleId?: string
): Promise<void> {
  const message = errorMessage(error);
  const retrying = willRetryJob(job, error);

  await job.log(`${job.name} failed: ${message}`);
  await markArticleFailed(articleId, message);
  await recordGenerationProgress(job, job.data.campaignId, publishJobId, {
    step: retrying ? "article:generation_retry_scheduled" : "article:generation_failed",
    percent: retrying ? 20 : 100,
    label: retrying ? "生成失败，等待自动重试" : "生成失败",
    detail: message,
    articleId,
    status: retrying ? "retrying" : "failed"
  });

  if (job.data.campaignId) {
    const campaign = await prisma.blogCampaign.findUnique({
      where: { id: job.data.campaignId },
      select: { metadata: true }
    });
    const metadata = isRecord(campaign?.metadata) ? campaign.metadata : {};
    await prisma.blogCampaign.update({
      where: { id: job.data.campaignId },
      data: {
        status: retrying ? "active" : "failed",
        metadata: toPrismaJson({
          ...metadata,
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

  const storefrontHost = await resolveStorefrontHostForStore(store, "sync");
  const locale = normalizeLocale(campaign?.locale ?? article?.locale ?? data.locale);
  const sourceType = campaign?.sourceType ?? article?.sourceType ?? data.sourceType;
  const sourceId = campaign?.sourceId ?? article?.sourceId ?? data.sourceId;
  const generationConfig = resolveGenerationConfig(data.generationConfig, campaign?.metadata);
  const initialTopic = firstNonBlank(campaign?.topic, article?.title, data.topic);
  const [brandVoice, requestedSourceContext, recentTopics, agentMemories] = await Promise.all([
    loadBrandVoice(data.organizationId, data.storeId, locale, campaign?.brandVoice),
    loadSourceContext(data.storeId, sourceType, sourceId),
    loadRecentTopicHistory(data.organizationId, data.storeId, locale, campaign?.id ?? data.campaignId),
    loadAgentMemories(data.organizationId, data.storeId, locale, sourceType, sourceId, generationConfig)
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
    storefrontHost,
    topic: topicSeed,
    seedKeywords,
    recentTopics,
    agentMemories,
    generationConfig
  } satisfies ContentSourceContext;
  const [trendSignals, internalLinks, imageReferences] = await Promise.all([
    discoverTrendSignals({
      topic: fallbackTopicSeed ?? "Shopify blog topic",
      locale,
      generationConfig,
      context: sourceContextBase
    }),
    loadInternalLinks(storefrontHost, data.storeId, effectiveSourceType, effectiveSourceId, generationConfig, data.articleId),
    loadImageReferences(data.storeId, sourceContextBase, generationConfig)
  ]);
  const externalReferences = externalReferenceCandidates({
    ...sourceContextBase,
    trendSignals
  });
  const enrichedContextBase = {
    ...sourceContextBase,
    trendSignals,
    externalReferences,
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
      externalReferences,
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

async function loadAgentMemories(
  organizationId: string,
  storeId: string,
  locale: string,
  sourceType: SourceType,
  sourceId: string | null | undefined,
  generationConfig: GenerationConfig | undefined
): Promise<AgentMemorySignal[]> {
  const now = new Date();
  const memoryWindowDays = clampMemoryWindowDays(generationConfig?.seoAgent?.memoryWindowDays);
  const memoryWindowStart = dateDaysAgo(memoryWindowDays, now);
  const scopeFilters: Array<{ sourceId?: string | null; sourceType?: SourceType }> = [
    { sourceId: null },
    { sourceType }
  ];
  if (sourceId) scopeFilters.unshift({ sourceId });
  const memories = await prisma.agentMemory.findMany({
    where: {
      organizationId,
      storeId,
      locale,
      OR: [
        {
          AND: [
            { OR: scopeFilters },
            {
              OR: [
                { lastUsedAt: { gte: memoryWindowStart } },
                { createdAt: { gte: memoryWindowStart } },
                { confidence: { gte: 85 } }
              ]
            }
          ]
        },
        { avoidUntil: { gt: now } }
      ]
    },
    orderBy: [{ confidence: "desc" }, { lastUsedAt: "desc" }],
    take: 60
  });

  const selectedMemories = selectAgentMemoryRows(memories, 30);
  const selectedIds = selectedMemories.map((memory) => memory.id).filter(Boolean);
  if (selectedIds.length > 0) {
    await prisma.agentMemory.updateMany({
      where: { id: { in: selectedIds } },
      data: { lastUsedAt: now }
    });
  }

  return selectedMemories.map((memory) => ({
    keyword: memory.keyword ?? undefined,
    topic: memory.topicFingerprint ?? undefined,
    angleKey: memory.angleKey ?? undefined,
    outcome: memory.outcome,
    confidence: memory.confidence,
    qualityScore: memory.qualityScore ?? undefined,
    trafficScore: memory.trafficScore ?? undefined,
    learnedRule: memory.learnedRule ?? undefined,
    avoidUntil: memory.avoidUntil?.toISOString(),
    lastUsedAt: memory.lastUsedAt.toISOString()
  }));
}

export interface AgentMemoryRowForSelection {
  id: string;
  keyword: string | null;
  topicFingerprint: string | null;
  angleKey: string | null;
  outcome: AgentMemorySignal["outcome"];
  confidence: number;
  qualityScore: number | null;
  trafficScore: number | null;
  learnedRule: string | null;
  avoidUntil: Date | null;
  lastUsedAt: Date;
  createdAt?: Date;
}

export function selectAgentMemoryRows<T extends AgentMemoryRowForSelection>(rows: T[], limit = 30, now = new Date()): T[] {
  const selected: T[] = [];
  const seen = new Set<string>();
  const sorted = [...rows].sort((left, right) => agentMemorySortScore(right, now) - agentMemorySortScore(left, now));

  for (const row of sorted) {
    if (!isUsefulAgentMemory(row, now)) continue;
    const key = agentMemorySelectionKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(row);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function clampMemoryWindowDays(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 180;
  return Math.max(7, Math.min(730, Math.round(value)));
}

function dateDaysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function isUsefulAgentMemory(memory: AgentMemoryRowForSelection, now: Date): boolean {
  if (memory.avoidUntil && memory.avoidUntil.getTime() > now.getTime()) return true;
  if (memory.confidence >= 45) return true;
  if (memory.qualityScore !== null && memory.qualityScore < 78) return true;
  if (memory.trafficScore !== null && memory.trafficScore < 78) return true;
  return ["failed", "rejected", "warning"].includes(memory.outcome);
}

function agentMemorySelectionKey(memory: AgentMemoryRowForSelection): string {
  return [
    normalizeAgentKeyword(memory.keyword) ?? "",
    memory.angleKey ?? "",
    normalizeAgentKeyword(memory.topicFingerprint) ?? "",
    memory.outcome
  ].join("|");
}

function agentMemorySortScore(memory: AgentMemoryRowForSelection, now: Date): number {
  const activeAvoid = memory.avoidUntil && memory.avoidUntil.getTime() > now.getTime() ? 60 : 0;
  const failedBoost = ["failed", "rejected"].includes(memory.outcome) ? 18 : memory.outcome === "warning" ? 10 : 0;
  const qualityBoost =
    memory.qualityScore !== null && memory.qualityScore < 82 ? Math.min(18, Math.round((82 - memory.qualityScore) / 2)) : 0;
  const trafficBoost =
    memory.trafficScore !== null && memory.trafficScore < 82 ? Math.min(18, Math.round((82 - memory.trafficScore) / 2)) : 0;
  const recencyDays = Math.max(0, (now.getTime() - memory.lastUsedAt.getTime()) / (24 * 60 * 60 * 1000));
  const recencyScore = Math.max(0, 20 - recencyDays / 7);
  return activeAvoid + failedBoost + qualityBoost + trafficBoost + memory.confidence + recencyScore;
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
    externalReferences: isRecord(candidate.externalReferences)
      ? {
          enabled: candidate.externalReferences.enabled !== false,
          minLinks: numberValue(candidate.externalReferences.minLinks),
          maxLinks: numberValue(candidate.externalReferences.maxLinks),
          requireEveryArticle: candidate.externalReferences.requireEveryArticle !== false
        }
      : undefined,
    imageGeneration: isRecord(candidate.imageGeneration)
      ? {
          enabled: candidate.imageGeneration.enabled !== false,
          placement: imagePlacement(candidate.imageGeneration.placement),
          imageCount: numberValue(candidate.imageGeneration.imageCount),
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
              OR: [{ status: null }, { status: { equals: "ACTIVE", mode: "insensitive" } }],
              AND: [
                {
                  OR: [{ shopifyProductId: sourceId }, { id: sourceId }, { handle: sourceId }]
                }
              ]
            },
            orderBy: { syncedAt: "desc" }
          })
      : Promise.resolve(null),
    strategy === "collection" || strategy === "article"
      ? Promise.resolve([])
      : prisma.productSnapshot.findMany({
          where: {
            OR: [{ status: null }, { status: { equals: "ACTIVE", mode: "insensitive" } }],
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
          url: storefrontUrl(shopDomain, `/products/${sourceProduct.handle}`),
          type: "product" as const,
          anchor: sourceProduct.seoTitle ?? sourceProduct.title,
          reason: sourceProduct.productType || "Primary product page"
        }
      ]
    : [];
  const productLinks = products.map((product) => ({
    title: product.title,
    url: storefrontUrl(shopDomain, `/products/${product.handle}`),
    type: "product" as const,
    anchor: product.seoTitle ?? product.title,
    reason: product.productType ?? undefined
  }));
  const collectionLinks = collections.map((collection) => ({
    title: collection.title,
    url: storefrontUrl(shopDomain, `/collections/${collection.handle}`),
    type: "collection" as const,
    anchor: collection.title
  }));
  const articleLinks = articles.map((article) => ({
    title: article.title ?? "Related article",
    url: rewriteUrlHost(article.canonicalUrl, shopDomain) ?? storefrontUrl(shopDomain, `/blogs/news/${article.handle}`),
    type: "article" as const,
    anchor: article.title ?? article.primaryKeyword ?? "Related article"
  }));

  return verifyInternalLinkCandidates(mixInternalLinkCandidates([sourceProductLinks, collectionLinks, articleLinks, productLinks], limit), {
    timeoutMs: internalLinkValidationTimeoutMs()
  });
}

function storefrontUrl(host: string, path: string): string {
  return `https://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

function rewriteUrlHost(value: string | null | undefined, host: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.hostname = host;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
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

async function persistSeoAgentRun(input: {
  articleId: string;
  campaignId?: string;
  organizationId: string;
  storeId: string;
  locale: SupportedLocale;
  sourceType: SourceType;
  sourceId?: string;
  generationConfig?: GenerationConfig;
  pipelineResult: AgentContentPipelineResult;
  qualityPassed?: boolean;
  finalSeoScore?: number;
  finalTrafficScore?: number;
  publishJobId?: string;
}) {
  const agentRun = input.pipelineResult.artifacts.agentRun;
  if (!agentRun) return;

  try {
    const run = await prisma.seoTopicRun.upsert({
      where: { runId: agentRun.runId },
      update: {
        articleId: input.articleId,
        campaignId: input.campaignId,
        status: agentRun.status,
        selectedTopic: agentRun.topicSelection.selected.topic,
        objective: agentRun.objective,
        configSnapshot: toPrismaJson(input.generationConfig ?? null),
        research: toPrismaJson(agentRun.research),
        contentBrief: toPrismaJson(agentRun.contentBrief),
        reflection: toPrismaJson(agentRun.reflection),
        memory: toPrismaJson(agentRun.memory),
        completedAt: dateValue(agentRun.finishedAt)
      },
      create: {
        runId: agentRun.runId,
        organizationId: input.organizationId,
        storeId: input.storeId,
        campaignId: input.campaignId,
        articleId: input.articleId,
        locale: input.locale,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: agentRun.status,
        strategy: input.generationConfig?.topicDiscovery?.strategy ?? "seo_agent",
        selectedTopic: agentRun.topicSelection.selected.topic,
        objective: agentRun.objective,
        agentVersion: agentRun.agentVersion,
        configSnapshot: toPrismaJson(input.generationConfig ?? null),
        research: toPrismaJson(agentRun.research),
        contentBrief: toPrismaJson(agentRun.contentBrief),
        reflection: toPrismaJson(agentRun.reflection),
        memory: toPrismaJson(agentRun.memory),
        startedAt: dateValue(agentRun.startedAt),
        completedAt: dateValue(agentRun.finishedAt)
      }
    });

    await prisma.seoTopicCandidate.deleteMany({ where: { topicRunId: run.id } });
    const candidates = await Promise.all(
      agentRun.topicSelection.candidates.map((candidate) =>
        prisma.seoTopicCandidate.create({
          data: {
            topicRunId: run.id,
            topic: candidate.topic,
            primaryKeyword: candidate.primaryKeyword,
            score: candidate.score,
            funnelStage: candidate.agent?.funnelStage,
            searchIntent: candidate.agent?.searchIntent,
            angleKey: candidate.agent?.angleKey,
            impactScore: candidate.scoring.impact,
            confidenceScore: candidate.scoring.confidence,
            noveltyScore: candidate.scoring.novelty,
            commerceScore: candidate.scoring.commerceFit,
            opportunityScore: candidate.scoring.opportunity,
            selected: candidate.id === agentRun.topicSelection.selected.id,
            rejectedReason: agentRun.topicSelection.rejected.find((item) => item.topic === candidate.topic)?.reason,
            evidence: toPrismaJson(candidate.evidence),
            metadata: toPrismaJson({
              candidateId: candidate.id,
              briefAngle: candidate.briefAngle,
              audiencePromise: candidate.audiencePromise,
              riskFlags: candidate.riskFlags,
              reasons: candidate.reasons,
              agent: candidate.agent
            })
          }
        })
      )
    );
    const selectedCandidate = candidates.find((candidate) => candidate.selected);
    if (selectedCandidate) {
      await prisma.seoTopicRun.update({
        where: { id: run.id },
        data: { selectedCandidateId: selectedCandidate.id }
      });
    }

    await persistAgentRuntimeArtifacts({
      runId: run.id,
      agentRunId: agentRun.runId,
      articleId: input.articleId,
      campaignId: input.campaignId,
      organizationId: input.organizationId,
      storeId: input.storeId,
      locale: input.locale,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      qualityPassed: input.qualityPassed,
      finalSeoScore: input.finalSeoScore,
      finalTrafficScore: input.finalTrafficScore,
      agentRun
    });
  } catch (error) {
    try {
      await writePublishLog({
        organizationId: input.organizationId,
        storeId: input.storeId,
        jobId: input.publishJobId,
        articleId: input.articleId,
        event: "failed",
        level: "warn",
        message: "SEO Agent run metadata could not be persisted to structured tables; JSON article metadata was still saved.",
        payload: { error: getErrorMessage(error), runId: agentRun.runId }
      });
    } catch {
      // Structured SEO Agent persistence is non-critical once article JSON metadata is saved.
    }
  }
}

async function persistAgentRuntimeArtifacts(input: {
  runId: string;
  agentRunId: string;
  articleId: string;
  campaignId?: string;
  organizationId: string;
  storeId: string;
  locale: SupportedLocale;
  sourceType: SourceType;
  sourceId?: string;
  qualityPassed?: boolean;
  finalSeoScore?: number;
  finalTrafficScore?: number;
  agentRun: AgentContentPipelineResult["artifacts"]["agentRun"];
}) {
  await Promise.all([
    prisma.agentToolCall.deleteMany({ where: { topicRunId: input.runId } }),
    prisma.agentReflectionTask.deleteMany({ where: { topicRunId: input.runId } })
  ]);

  if (input.agentRun.toolCalls.length > 0) {
    await prisma.agentToolCall.createMany({
      data: input.agentRun.toolCalls.map((call) => ({
        organizationId: input.organizationId,
        storeId: input.storeId,
        topicRunId: input.runId,
        campaignId: input.campaignId,
        articleId: input.articleId,
        runId: input.agentRunId,
        stage: call.stage,
        agentRole: call.agentRole,
        toolName: call.toolName,
        purpose: call.purpose,
        status: call.status,
        input: toPrismaJson(call.input ?? null),
        output: toPrismaJson(call.output ?? null),
        evidence: toPrismaJson(call.evidence),
        warnings: call.warnings,
        startedAt: dateValue(call.startedAt),
        completedAt: dateValue(call.finishedAt),
        latencyMs: call.latencyMs,
        metadata: toPrismaJson({
          planId: call.planId,
          evidenceIds: call.evidenceIds ?? [],
          decisionSummary: call.decisionSummary
        })
      }))
    });
  }

  if (input.agentRun.reflectionTasks.length > 0) {
    await prisma.agentReflectionTask.createMany({
      data: input.agentRun.reflectionTasks.map((task) => ({
        organizationId: input.organizationId,
        storeId: input.storeId,
        topicRunId: input.runId,
        campaignId: input.campaignId,
        articleId: input.articleId,
        priority: task.priority,
        agentRole: task.agentRole,
        instruction: task.instruction,
        acceptanceCheck: task.acceptanceCheck,
        status: task.status,
        evidenceIds: task.evidenceIds,
        metadata: toPrismaJson({ source: "seo_agent_reflection" })
      }))
    });
  }

  await Promise.all(
    collectAgentEvidence(input.agentRun).map((evidence) =>
      prisma.agentEvidence.upsert({
        where: {
          storeId_dedupeHash: {
            storeId: input.storeId,
            dedupeHash: agentEvidenceHash(input.locale, evidence)
          }
        },
        update: {
          topicRunId: input.runId,
          campaignId: input.campaignId,
          articleId: input.articleId,
          confidence: evidence.confidence,
          relevanceScore: evidence.relevanceScore,
          metric: evidence.metric,
          metadata: toPrismaJson(evidence),
          expiresAt: agentEvidenceExpiresAt(evidence)
        },
        create: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          topicRunId: input.runId,
          campaignId: input.campaignId,
          articleId: input.articleId,
          locale: input.locale,
          evidenceType: evidence.type,
          source: evidence.source,
          normalizedKeyword: normalizeAgentKeyword(evidence.value),
          value: evidence.value,
          url: evidence.url,
          query: evidence.label,
          publishedAt: dateValue(evidence.publishedAt),
          metric: evidence.metric,
          relevanceScore: evidence.relevanceScore,
          confidence: evidence.confidence,
          expiresAt: agentEvidenceExpiresAt(evidence),
          dedupeHash: agentEvidenceHash(input.locale, evidence),
          metadata: toPrismaJson(evidence)
        }
      })
    )
  );

  const memoryData = buildAgentMemoryPersistenceData(input);
  const existingMemory = await prisma.agentMemory.findFirst({
    where: {
      organizationId: memoryData.organizationId,
      storeId: memoryData.storeId,
      locale: memoryData.locale,
      sourceType: memoryData.sourceType,
      sourceId: memoryData.sourceId,
      keyword: memoryData.keyword,
      angleKey: memoryData.angleKey,
      topicFingerprint: memoryData.topicFingerprint
    },
    orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }]
  });
  if (existingMemory) {
    await prisma.agentMemory.update({
      where: { id: existingMemory.id },
      data: {
        campaignId: memoryData.campaignId,
        articleId: memoryData.articleId,
        outcome: memoryData.outcome,
        confidence: Math.max(existingMemory.confidence, memoryData.confidence),
        qualityScore: memoryData.qualityScore,
        trafficScore: memoryData.trafficScore,
        learnedRule: memoryData.learnedRule,
        avoidUntil: memoryData.avoidUntil,
        evidence: memoryData.evidence,
        metadata: memoryData.metadata,
        lastUsedAt: new Date()
      }
    });
  } else {
    await prisma.agentMemory.create({ data: memoryData });
  }
}

export function buildAgentMemoryPersistenceData(input: {
  agentRunId: string;
  articleId: string;
  campaignId?: string;
  organizationId: string;
  storeId: string;
  locale: SupportedLocale;
  sourceType: SourceType;
  sourceId?: string;
  qualityPassed?: boolean;
  finalSeoScore?: number;
  finalTrafficScore?: number;
  agentRun: AgentContentPipelineResult["artifacts"]["agentRun"];
}) {
  return {
    organizationId: input.organizationId,
    storeId: input.storeId,
    campaignId: input.campaignId ?? null,
    articleId: input.articleId,
    locale: input.locale,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    keyword: input.agentRun.keywordStrategy.primaryKeyword,
    angleKey: input.agentRun.topicSelection.selected.agent?.angleKey ?? null,
    topicFingerprint: normalizeAgentKeyword(input.agentRun.topicSelection.selected.topic) ?? null,
    outcome: input.qualityPassed ? "success" as const : input.agentRun.status === "failed" ? "failed" as const : "warning" as const,
    confidence: input.qualityPassed ? 86 : 62,
    qualityScore: input.finalSeoScore ?? null,
    trafficScore: input.finalTrafficScore ?? null,
    learnedRule: buildAgentLearnedRule(input),
    avoidUntil: input.qualityPassed ? null : daysFromNow(21),
    evidence: toPrismaJson(input.agentRun.topicSelection.selected.evidence),
    metadata: toPrismaJson({
      runId: input.agentRunId,
      selectedTopic: input.agentRun.topicSelection.selected.topic,
      reflectionDecision: input.agentRun.reflection.publishDecision,
      memorySnapshot: input.agentRun.memory
    })
  };
}

function collectAgentEvidence(agentRun: AgentContentPipelineResult["artifacts"]["agentRun"]): KeywordEvidenceItem[] {
  const all = [
    ...agentRun.research.evidence,
    ...(agentRun.keywordStrategy.evidenceItems ?? []),
    ...agentRun.topicSelection.selected.evidence
  ];
  const seen = new Set<string>();
  const output: KeywordEvidenceItem[] = [];
  for (const evidence of all) {
    const key = agentEvidenceHash(agentRun.keywordStrategy.locale, evidence);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(evidence);
  }
  return output.slice(0, 80);
}

function agentEvidenceHash(locale: string, evidence: KeywordEvidenceItem): string {
  return hashString([locale, evidence.type, evidence.source, evidence.value, evidence.url ?? ""].join("|")).toString(36);
}

function agentEvidenceExpiresAt(evidence: KeywordEvidenceItem): Date | undefined {
  if (evidence.type === "trend") return daysFromNow(30);
  if (evidence.type === "internal_link") return daysFromNow(90);
  return undefined;
}

function buildAgentLearnedRule(input: {
  qualityPassed?: boolean;
  finalTrafficScore?: number;
  agentRun: AgentContentPipelineResult["artifacts"]["agentRun"];
}): string {
  const angle = input.agentRun.topicSelection.selected.agent?.angleKey ?? "selected angle";
  const keyword = input.agentRun.keywordStrategy.primaryKeyword;
  if (input.qualityPassed) {
    return `Reuse ${angle} for ${keyword} only when fresh evidence and a non-repeating title are available.`;
  }
  return `Avoid repeating ${angle} for ${keyword} until the reflection tasks are resolved and the AI search score improves above ${input.finalTrafficScore ?? "the target"}.`;
}

function normalizeAgentKeyword(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return normalized || undefined;
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isAgentPipelineResult(result: ContentPipelineResult | AgentContentPipelineResult): result is AgentContentPipelineResult {
  return Boolean((result.artifacts as { agentRun?: unknown }).agentRun);
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
  options: {
    authorName: string;
    coverImage?: ShopifyArticleImageInput;
  }
): Promise<ShopifyArticle> {
  const seoDescription = trimForShopifySeoDescription(article.seoDescription ?? article.summary ?? article.title ?? "");
  const seoTitle = trimForShopifySeoTitle(article.seoTitle ?? article.title ?? "");
  const input = {
    blogId: shopifyBlogId,
    title: article.title ?? "Untitled article",
    author: options.authorName,
    handle: article.handle ?? undefined,
    bodyHtml: article.bodyHtml ?? "",
    summary: seoDescription || article.summary || undefined,
    seoTitle: seoTitle || undefined,
    seoDescription: seoDescription || undefined,
    isPublished: true,
    tags: article.tags ?? [],
    image: options.coverImage
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

function dateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
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
