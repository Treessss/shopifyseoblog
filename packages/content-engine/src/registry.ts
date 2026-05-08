import {
  buildDefaultDraft,
  defaultHtmlAssembler,
  defaultKeywordPlanner,
  defaultPromptBuilder,
  defaultQualityGate,
  defaultSeoScorer,
  normalizePipelineLocale
} from "./components";
import type {
  ContentPipelineArtifacts,
  ContentPipelineInput,
  ContentPipelineResult,
  ContentPipelineRunOptions,
  ContentSourceContext,
  GeneratedArticle,
  HtmlAssembler,
  KeywordPlanner,
  NormalizedContentPipelineInput,
  PromptBuilder,
  QualityGate,
  SeoScorer
} from "./types";

export class ContentPipelineRegistry {
  private readonly keywordPlanners = new Map<string, KeywordPlanner>();
  private readonly promptBuilders = new Map<string, PromptBuilder>();
  private readonly htmlAssemblers = new Map<string, HtmlAssembler>();
  private readonly seoScorers = new Map<string, SeoScorer>();
  private readonly qualityGates = new Map<string, QualityGate>();

  registerKeywordPlanner(name: string, planner: KeywordPlanner): this {
    this.keywordPlanners.set(name, planner);
    return this;
  }

  registerPromptBuilder(name: string, builder: PromptBuilder): this {
    this.promptBuilders.set(name, builder);
    return this;
  }

  registerHtmlAssembler(name: string, assembler: HtmlAssembler): this {
    this.htmlAssemblers.set(name, assembler);
    return this;
  }

  registerSeoScorer(name: string, scorer: SeoScorer): this {
    this.seoScorers.set(name, scorer);
    return this;
  }

  registerQualityGate(name: string, gate: QualityGate): this {
    this.qualityGates.set(name, gate);
    return this;
  }

  getKeywordPlanner(name = "default"): KeywordPlanner {
    return getRegistered(this.keywordPlanners, name, "keyword planner");
  }

  getPromptBuilder(name = "default"): PromptBuilder {
    return getRegistered(this.promptBuilders, name, "prompt builder");
  }

  getHtmlAssembler(name = "default"): HtmlAssembler {
    return getRegistered(this.htmlAssemblers, name, "HTML assembler");
  }

  getSeoScorer(name = "default"): SeoScorer {
    return getRegistered(this.seoScorers, name, "SEO scorer");
  }

  getQualityGate(name = "default"): QualityGate {
    return getRegistered(this.qualityGates, name, "quality gate");
  }

  list() {
    return {
      keywordPlanners: Array.from(this.keywordPlanners.keys()),
      promptBuilders: Array.from(this.promptBuilders.keys()),
      htmlAssemblers: Array.from(this.htmlAssemblers.keys()),
      seoScorers: Array.from(this.seoScorers.keys()),
      qualityGates: Array.from(this.qualityGates.keys())
    };
  }

  async run(
    input: ContentPipelineInput,
    context: ContentSourceContext = {},
    options: ContentPipelineRunOptions = {}
  ): Promise<ContentPipelineResult> {
    const normalized = normalizePipelineInput(input, context);
    const keywordPlanner = this.getKeywordPlanner(options.keywordPlanner);
    const promptBuilder = this.getPromptBuilder(options.promptBuilder);
    const htmlAssembler = this.getHtmlAssembler(options.htmlAssembler);
    const seoScorer = this.getSeoScorer(options.seoScorer);
    const qualityGate = this.getQualityGate(options.qualityGate);

    const keywords = await keywordPlanner.plan(normalized, context);
    const prompts = await promptBuilder.build(normalized, context, keywords);
    const draft = buildDefaultDraft(normalized, context, keywords);
    const html = await htmlAssembler.assemble(normalized, context, keywords, draft);
    const seo = await seoScorer.score(html, keywords, normalized);
    const quality = await qualityGate.evaluate(html, seo, normalized, context);

    const artifacts: ContentPipelineArtifacts = {
      keywords,
      prompts,
      draft,
      html,
      seo,
      quality
    };

    return {
      article: toGeneratedArticle(normalized, keywords, html, seo.score, quality.passed),
      artifacts
    };
  }
}

export function createDefaultContentPipelineRegistry(): ContentPipelineRegistry {
  return new ContentPipelineRegistry()
    .registerKeywordPlanner("default", defaultKeywordPlanner)
    .registerPromptBuilder("default", defaultPromptBuilder)
    .registerHtmlAssembler("default", defaultHtmlAssembler)
    .registerSeoScorer("default", defaultSeoScorer)
    .registerQualityGate("default", defaultQualityGate);
}

export function createContentPipelineRegistry(): ContentPipelineRegistry {
  return createDefaultContentPipelineRegistry();
}

export const defaultContentPipelineRegistry = createDefaultContentPipelineRegistry();

export async function runContentPipeline(
  input: ContentPipelineInput,
  context: ContentSourceContext = {},
  options: ContentPipelineRunOptions = {}
): Promise<ContentPipelineResult> {
  return defaultContentPipelineRegistry.run(input, context, options);
}

export async function generateArticle(
  input: ContentPipelineInput,
  context: ContentSourceContext = {},
  options: ContentPipelineRunOptions = {}
): Promise<GeneratedArticle> {
  const result = await runContentPipeline(input, context, options);
  return result.article;
}

function normalizePipelineInput(input: ContentPipelineInput, context: ContentSourceContext): NormalizedContentPipelineInput {
  const locale = normalizePipelineLocale(input.locale);
  const topic = input.topic ?? context.topic ?? context.product?.title ?? context.collection?.title ?? "Shopify blog topic";
  const sourceType = input.sourceType ?? (context.product ? "product" : context.collection ? "collection" : "manual_topic");

  return {
    organizationId: input.organizationId,
    storeId: input.storeId,
    locale,
    sourceType,
    sourceId: input.sourceId ?? context.product?.id ?? context.collection?.id,
    topic,
    publishPolicy: input.publishPolicy ?? "auto_when_qualified",
    targetWordCount: input.targetWordCount ?? 1400,
    primaryKeyword: input.primaryKeyword
  };
}

function toGeneratedArticle(
  input: NormalizedContentPipelineInput,
  keywords: { primaryKeyword: string; secondaryKeywords: string[] },
  html: {
    title: string;
    handle: string;
    summary: string;
    bodyHtml: string;
    tags: string[];
    imagePrompt?: string;
    imageAlt?: string;
  },
  seoScore: number,
  qualityPassed: boolean
): GeneratedArticle {
  return {
    title: html.title,
    handle: html.handle,
    summary: html.summary,
    bodyHtml: html.bodyHtml,
    primaryKeyword: keywords.primaryKeyword,
    secondaryKeywords: keywords.secondaryKeywords,
    tags: html.tags,
    locale: input.locale,
    seoScore,
    qualityPassed,
    imagePrompt: html.imagePrompt,
    imageAlt: html.imageAlt
  };
}

function getRegistered<T>(items: Map<string, T>, name: string, label: string): T {
  const item = items.get(name);
  if (!item) {
    throw new Error(`Unknown ${label}: ${name}`);
  }
  return item;
}
