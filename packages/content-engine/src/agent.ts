import {
  buildDefaultDraft,
  buildKeywordEvidence,
  selectTopicCandidate
} from "./components";
import { defaultContentPipelineRegistry, mergeInputSeedKeywords, normalizePipelineInput, runContentPipeline } from "./registry";
import { discoverTrendSignals } from "./trends";
import type {
  AgentContentPipelineArtifacts,
  AgentContentPipelineResult,
  AgentRunStage,
  AgentStageName,
  AgentStageStatus,
  ContentBrief,
  ContentPipelineInput,
  ContentPipelineRunOptions,
  ContentSourceContext,
  ImageReference,
  InternalLinkCandidate,
  KeywordEvidenceItem,
  KeywordPlan,
  KeywordPlanner,
  KeywordStrategy,
  NormalizedContentPipelineInput,
  ReflectionReport,
  ResearchBrief,
  SeoAgentRun,
  TopicCandidate,
  TopicCandidateV2,
  TopicMemorySnapshot,
  TopicSelectionResult,
  TopicSelectionResultV2,
  TrendSignal
} from "./types";

const SEO_AGENT_VERSION = "seo-agent-commercial-1.0.0";

export async function runAgentContentPipeline(
  input: ContentPipelineInput,
  context: ContentSourceContext = {},
  options: ContentPipelineRunOptions = {}
): Promise<AgentContentPipelineResult> {
  const normalized = normalizePipelineInput(input, context);
  const startedAt = nowIso();
  const runId = `seo-agent-${hashString(`${normalized.organizationId ?? ""}:${normalized.storeId ?? ""}:${normalized.topic}:${startedAt}`).toString(36)}`;
  const stages: AgentRunStage[] = [];
  const baseContext = mergeInputSeedKeywords(input, context);
  const keywordPlanner = defaultContentPipelineRegistry.getKeywordPlanner(options.keywordPlanner);

  const researchStageStart = nowIso();
  const researchResult = await buildResearchBrief(normalized, baseContext, options);
  const research = researchResult.research;
  const researchContext = {
    ...baseContext,
    trendSignals: research.trendSignals,
    internalLinks: research.internalLinks,
    imageReferences: research.imageReferences,
    keywordEvidence: research.evidence
  } satisfies ContentSourceContext;
  stages.push(
    stage("research", researchStageStart, { topic: normalized.topic, sourceType: normalized.sourceType }, research, research.evidence, researchResult.warnings)
  );

  const keywordStageStart = nowIso();
  const keywordStrategy = await buildKeywordStrategy(normalized, researchContext, research, keywordPlanner);
  stages.push(stage("keyword_strategy", keywordStageStart, { topic: normalized.topic }, keywordStrategy, keywordStrategy.evidenceItems ?? research.evidence));

  const topicStageStart = nowIso();
  const topicSelection = context.topicSelection ?? selectTopicCandidate({ ...normalized, primaryKeyword: normalized.primaryKeyword ?? keywordStrategy.primaryKeyword }, researchContext);
  const topicSelectionV2 = buildTopicSelectionV2(topicSelection, keywordStrategy, researchContext);
  const minOpportunityScore = normalized.generationConfig?.seoAgent?.minOpportunityScore ?? 70;
  const opportunityWarnings =
    topicSelectionV2.selected.scoring.opportunity < minOpportunityScore
      ? [`Selected topic opportunity score ${topicSelectionV2.selected.scoring.opportunity} is below configured minimum ${minOpportunityScore}.`]
      : [];
  const topicContext = {
    ...researchContext,
    topic: topicSelectionV2.selected.topic,
    topicSelection,
    keywordEvidence: topicSelectionV2.selected.evidence
  } satisfies ContentSourceContext;
  stages.push(
    stage(
      "topic_selection",
      topicStageStart,
      { candidateCount: topicSelection.candidates.length, minOpportunityScore },
      topicSelectionV2,
      topicSelectionV2.selected.evidence,
      opportunityWarnings,
      opportunityWarnings.length ? "failed" : undefined
    )
  );

  const briefStageStart = nowIso();
  const contentBrief = buildContentBrief(normalized, topicContext, keywordStrategy, topicSelectionV2, research);
  stages.push(stage("content_brief", briefStageStart, { topic: topicSelectionV2.selected.topic }, contentBrief, topicSelectionV2.selected.evidence));

  const resolvedInput = {
    ...input,
    topic: topicSelectionV2.selected.topic,
    primaryKeyword: input.primaryKeyword ?? topicSelectionV2.selected.primaryKeyword
  } satisfies ContentPipelineInput;

  const draftStageStart = nowIso();
  const pipelineResult = await runContentPipeline(resolvedInput, topicContext, options);
  stages.push(
    stage(
      "draft_generation",
      draftStageStart,
      { topic: topicSelectionV2.selected.topic, primaryKeyword: topicSelectionV2.selected.primaryKeyword },
      {
        title: pipelineResult.article.title,
        handle: pipelineResult.article.handle,
        seoScore: pipelineResult.article.seoScore,
        qualityPassed: pipelineResult.article.qualityPassed
      },
      pipelineResult.artifacts.keywordEvidence ?? topicSelectionV2.selected.evidence,
      pipelineResult.article.qualityPassed ? [] : pipelineResult.artifacts.quality.reasons
    )
  );

  const reflectionStageStart = nowIso();
  const reflection = buildReflectionReport(pipelineResult, contentBrief, keywordStrategy, topicContext, topicSelectionV2, normalized);
  stages.push(
    stage(
      "quality_reflection",
      reflectionStageStart,
      { minSeoScore: normalized.generationConfig?.qualityGate?.minSeoScore ?? 78 },
      reflection,
      pipelineResult.artifacts.keywordEvidence ?? topicSelectionV2.selected.evidence,
      reflection.revisions.map((revision) => revision.instruction),
      reflection.publishDecision === "reject" ? "failed" : reflection.publishDecision === "revise" ? "warning" : "passed"
    )
  );

  const finishedAt = nowIso();
  const memory = buildTopicMemory(topicContext, topicSelectionV2.selected);
  const agentRun: SeoAgentRun = {
    runId,
    agentVersion: SEO_AGENT_VERSION,
    mode: normalized.generationConfig?.seoAgent?.agentMode ?? "commercial",
    objective: agentObjective(normalized),
    startedAt,
    finishedAt,
    status: finalAgentStatus(stages),
    stages,
    research,
    keywordStrategy,
    topicSelection: topicSelectionV2,
    contentBrief,
    reflection,
    memory
  };
  const artifacts: AgentContentPipelineArtifacts = {
    ...pipelineResult.artifacts,
    agentRun,
    research,
    keywordStrategy,
    topicSelectionV2,
    contentBrief,
    reflection
  };

  return {
    ...pipelineResult,
    runId,
    stages,
    artifacts
  };
}

async function buildResearchBrief(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext,
  options: ContentPipelineRunOptions
): Promise<{ research: ResearchBrief; warnings: string[] }> {
  const warnings: string[] = [];
  let trendSignals = context.trendSignals ?? [];
  if (trendSignals.length === 0 && input.generationConfig?.hotNews?.enabled) {
    try {
      trendSignals = await discoverTrendSignals({
        topic: input.topic,
        locale: input.locale,
        generationConfig: input.generationConfig,
        context,
        fetch: options.fetch
      });
    } catch (error) {
      warnings.push(`Trend discovery failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const evidenceContext = { ...context, trendSignals } satisfies ContentSourceContext;
  const evidence = buildKeywordEvidence(input, evidenceContext);
  const research: ResearchBrief = {
    sourceContext: {
      product: context.product,
      collection: context.collection,
      brandVoice: context.brandVoice,
      topic: context.topic,
      seedKeywords: context.seedKeywords
    },
    trendSignals,
    marketInsights: buildMarketInsights(trendSignals, evidence),
    competitorAngles: (context.competitorTitles ?? []).slice(0, 8).map((title) => ({
      title,
      angle: inferCompetitorAngle(title)
    })),
    internalLinks: context.internalLinks ?? [],
    imageReferences: context.imageReferences ?? [],
    evidence,
    riskFlags: researchRiskFlags(input, evidenceContext, trendSignals),
    sourceSummary: {
      trendCount: trendSignals.length,
      internalLinkCount: context.internalLinks?.length ?? 0,
      imageReferenceCount: context.imageReferences?.length ?? 0,
      recentTopicCount: context.recentTopics?.length ?? 0
    }
  };

  if (trendSignals.length === 0 && input.generationConfig?.hotNews?.enabled) {
    warnings.push("No usable trend/news signal was found; using evergreen catalog evidence.");
  }
  if (research.riskFlags.length > 0) warnings.push(...research.riskFlags);

  return { research, warnings };
}

async function buildKeywordStrategy(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext,
  research: ResearchBrief,
  keywordPlanner: KeywordPlanner
): Promise<KeywordStrategy> {
  const plan = await keywordPlanner.plan(input, context);
  const evidenceConfidence = average((plan.evidenceItems ?? research.evidence).map((item) => item.confidence));
  const trendBoost = Math.min(12, research.trendSignals.length * 3);
  const linkBoost = Math.min(8, research.internalLinks.length * 2);
  const opportunityScore = clampScore(evidenceConfidence * 0.55 + funnelWeight(plan.searchIntent) + trendBoost + linkBoost);
  const clustersInput = [
    {
      name: "Primary demand",
      intent: plan.searchIntent,
      keywords: [plan.primaryKeyword, ...plan.secondaryKeywords.slice(0, 3)]
    },
    {
      name: "Long-tail buying questions",
      intent: plan.searchIntent === "informational" ? "commercial" : plan.searchIntent,
      keywords: plan.longTailKeywords.slice(0, 4)
    },
    {
      name: "Trend expansion",
      intent: "informational",
      keywords: research.trendSignals.flatMap((signal) => tokenize(signal.title)).slice(0, 8)
    }
  ] satisfies KeywordStrategy["clusters"];
  const clusters = clustersInput.filter((cluster) => cluster.keywords.length > 0);

  return {
    ...plan,
    clusters,
    serpIntentConfidence: clampScore(62 + (plan.evidenceItems?.length ?? 0) * 4 + research.trendSignals.length * 3),
    opportunityScore,
    excludedKeywords: excludedKeywordCandidates(context, plan)
  };
}

function buildTopicSelectionV2(
  selection: TopicSelectionResult,
  keywords: KeywordStrategy,
  context: ContentSourceContext
): TopicSelectionResultV2 {
  const candidates = selection.candidates.map((candidate, index) => toTopicCandidateV2(candidate, keywords, context, index));
  const selected =
    candidates.find((candidate) => candidate.topic === selection.selected.topic) ?? toTopicCandidateV2(selection.selected, keywords, context, 0);
  const rejected = candidates
    .filter((candidate) => candidate.id !== selected.id)
    .map((candidate) => ({
      topic: candidate.topic,
      reason: candidate.score < selected.score ? "lower opportunity score" : "not selected after novelty and evidence review",
      score: candidate.score
    }));

  return {
    selected,
    candidates,
    rejected,
    decisionSummary: `Selected ${selected.agent?.angleKey ?? "topic"} for ${keywords.primaryKeyword} with opportunity score ${selected.scoring.opportunity}.`
  };
}

function toTopicCandidateV2(
  candidate: TopicCandidate,
  keywords: KeywordStrategy,
  context: ContentSourceContext,
  index: number
): TopicCandidateV2 {
  const commerceFit = commerceFitScore(candidate, keywords, context);
  const impact = candidate.agent?.impact ?? candidate.score;
  const confidence = candidate.agent?.confidence ?? average(candidate.evidence.map((item) => item.confidence));
  const novelty = candidate.agent?.noveltyScore ?? clampScore(80 - repeatedTopicPressure(candidate.topic, context));
  const opportunity = clampScore(impact * 0.34 + confidence * 0.28 + novelty * 0.2 + commerceFit * 0.18);

  return {
    ...candidate,
    id: `topic-${hashString(`${candidate.topic}:${candidate.primaryKeyword}:${index}`).toString(36)}`,
    briefAngle: briefAngle(candidate),
    audiencePromise: audiencePromise(candidate, keywords),
    scoring: {
      impact: clampScore(impact),
      confidence: clampScore(confidence),
      novelty,
      commerceFit,
      opportunity
    },
    riskFlags: topicRiskFlags(candidate, context),
    agent: candidate.agent
      ? {
          ...candidate.agent,
          agentVersion: SEO_AGENT_VERSION,
          commerceFit,
          scoringBreakdown: {
            impact: clampScore(impact),
            confidence: clampScore(confidence),
            novelty,
            commerceFit,
            opportunity
          },
          riskFlags: topicRiskFlags(candidate, context)
        }
      : candidate.agent
  };
}

function buildContentBrief(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext,
  keywords: KeywordStrategy,
  topicSelection: TopicSelectionResultV2,
  research: ResearchBrief
): ContentBrief {
  const draft = buildDefaultDraft({ ...input, topic: topicSelection.selected.topic, primaryKeyword: keywords.primaryKeyword }, context, keywords);
  const internalLinkPlan = research.internalLinks.slice(0, input.generationConfig?.internalLinks?.maxLinks ?? 4).map((link, index) => ({
    url: link.url,
    anchor: link.anchor ?? link.title,
    placement: index === 0 ? "first relevant decision section" : "supporting section"
  }));
  const imageReferences = research.imageReferences.slice(0, input.generationConfig?.imageGeneration?.referenceImageLimit ?? 6);

  return {
    titleDirection: topicSelection.selected.topic,
    primaryKeyword: keywords.primaryKeyword,
    searchIntent: keywords.searchIntent,
    audienceNeed: keywords.audienceNeed,
    outline: draft.sections,
    mustUseEvidenceIds: research.evidence.slice(0, 6).map(evidenceId),
    internalLinkPlan,
    imageBrief: {
      prompt: draft.imagePrompt ?? `${keywords.primaryKeyword} ecommerce editorial image`,
      alt: draft.imageAlt ?? keywords.primaryKeyword,
      references: imageReferences
    },
    claimsPolicy: [
      "Use trend/news signals only as editorial angles, not as unsupported claims.",
      "Use Shopify product facts as the source of product-specific truth.",
      "Do not invent discounts, availability, materials, certifications, or compatibility details."
    ]
  };
}

function buildReflectionReport(
  pipelineResult: Awaited<ReturnType<typeof runContentPipeline>>,
  brief: ContentBrief,
  keywords: KeywordStrategy,
  context: ContentSourceContext,
  topicSelection: TopicSelectionResultV2,
  input: NormalizedContentPipelineInput
): ReflectionReport {
  const article = pipelineResult.artifacts.html;
  const body = stripHtml(article.bodyHtml).toLowerCase();
  const missingLinks = brief.internalLinkPlan.filter((link) => !article.bodyHtml.includes(link.url)).map((link) => link.url);
  const missingEvidenceIds = brief.mustUseEvidenceIds.filter((id) => {
    const item = (pipelineResult.artifacts.keywordEvidence ?? []).find((evidence) => evidenceId(evidence) === id);
    if (!item) return false;
    return !body.includes(item.value.toLowerCase().slice(0, 28));
  });
  const unsupportedClaims = unsupportedClaimSignals(body, context.trendSignals ?? []);
  const revisions: ReflectionReport["revisions"] = [];

  if (pipelineResult.artifacts.seo.score < (pipelineResult.artifacts.quality.minSeoScore ?? 78)) {
    revisions.push({ priority: "P0", instruction: "Raise SEO score by improving title, summary, H2 keyword coverage, and internal semantic depth." });
  }
  if (missingLinks.length > 0) {
    revisions.push({ priority: "P1", instruction: `Add missing internal links where useful: ${missingLinks.slice(0, 3).join(", ")}` });
  }
  if (missingEvidenceIds.length > 3) {
    revisions.push({ priority: "P1", instruction: "Use more supplied evidence in the outline and body without fabricating facts." });
  }
  if (keywords.opportunityScore < 55) {
    revisions.push({ priority: "P2", instruction: "Reconsider the topic because the current opportunity score is weak." });
  }
  const minOpportunityScore = input.generationConfig?.seoAgent?.minOpportunityScore ?? 70;
  if (topicSelection.selected.scoring.opportunity < minOpportunityScore) {
    revisions.push({
      priority: "P0",
      instruction: `Re-run topic research or choose a stronger candidate because opportunity score ${topicSelection.selected.scoring.opportunity} is below ${minOpportunityScore}.`
    });
  }

  const factualityPassed = unsupportedClaims.length === 0;
  const passed = pipelineResult.artifacts.quality.passed && factualityPassed && revisions.filter((revision) => revision.priority === "P0").length === 0;
  const publishDecision = !passed && revisions.some((revision) => revision.priority === "P0") ? "reject" : passed && revisions.length === 0 ? "ready" : "revise";

  return {
    passed,
    publishDecision,
    seo: pipelineResult.artifacts.seo,
    editorial: pipelineResult.artifacts.quality.editorial,
    factuality: {
      passed: factualityPassed,
      unsupportedClaims
    },
    briefCompliance: {
      missingEvidenceIds,
      missingLinks
    },
    revisions,
    summary: passed
      ? "Article passed the commercial SEO agent reflection gate."
      : "Article needs revision before it should be treated as a high-confidence organic traffic asset."
  };
}

function buildTopicMemory(context: ContentSourceContext, selected: TopicCandidateV2): TopicMemorySnapshot {
  const lastTopics = (context.recentTopics ?? []).flatMap((item) => [item.topic, item.title]).filter((item): item is string => Boolean(item)).slice(0, 12);
  return {
    recentTopicCount: context.recentTopics?.length ?? 0,
    repeatedTopicCount: lastTopics.filter((topic) => tokenOverlap(tokenize(topic), tokenize(selected.topic)) >= 0.72).length,
    avoidedAngles: Array.from(new Set(lastTopics.map(inferAngleKey).filter((item): item is string => Boolean(item)))),
    lastTopics
  };
}

function stage<TInput, TOutput>(
  name: AgentStageName,
  startedAt: string,
  input: TInput,
  output: TOutput,
  evidence: KeywordEvidenceItem[] = [],
  warnings: string[] = [],
  forcedStatus?: AgentStageStatus
): AgentRunStage<TInput, TOutput> {
  return {
    id: `${name}-${hashString(`${name}:${startedAt}:${JSON.stringify(input).slice(0, 200)}`).toString(36)}`,
    stage: name,
    status: forcedStatus ?? (warnings.length ? "warning" : "passed"),
    input,
    output,
    evidence: evidence.slice(0, 12),
    warnings,
    startedAt,
    finishedAt: nowIso(),
    agentVersion: SEO_AGENT_VERSION
  };
}

function buildMarketInsights(signals: TrendSignal[], evidence: KeywordEvidenceItem[]) {
  return signals.slice(0, 5).map((signal) => ({
    insight: `${signal.title} can be used as a timely editorial angle when it matches product facts and shopper intent.`,
    sourceIds: [signal.url ?? signal.title],
    confidence: clampScore(58 + (signal.relevanceScore ?? 0) * 6 + (signal.traffic ? 8 : 0))
  })).concat(
    evidence.some((item) => item.type === "product")
      ? [{ insight: "Shopify catalog facts provide a stable evergreen content base.", sourceIds: ["shopify_catalog"], confidence: 82 }]
      : []
  );
}

function researchRiskFlags(input: NormalizedContentPipelineInput, context: ContentSourceContext, signals: TrendSignal[]): string[] {
  const flags: string[] = [];
  if (input.generationConfig?.hotNews?.enabled && signals.length === 0) flags.push("trend_discovery_empty");
  if (!context.product && !context.collection && !context.seedKeywords?.length) flags.push("weak_source_context");
  if (context.internalLinks?.length === 0 && input.generationConfig?.internalLinks?.enabled) flags.push("no_internal_links_available");
  return flags;
}

function topicRiskFlags(candidate: TopicCandidate, context: ContentSourceContext): string[] {
  const flags: string[] = [];
  if (!candidate.evidence.some((item) => item.type === "trend") && context.generationConfig?.qualityGate?.requireTrendEvidence) {
    flags.push("required_trend_evidence_missing");
  }
  if (repeatedTopicPressure(candidate.topic, context) >= 28) flags.push("recent_topic_similarity_high");
  return flags;
}

function commerceFitScore(candidate: TopicCandidate, keywords: KeywordPlan, context: ContentSourceContext): number {
  const intentBoost = keywords.searchIntent === "transactional" ? 18 : keywords.searchIntent === "commercial" ? 14 : keywords.searchIntent === "informational" ? 6 : 3;
  const catalogBoost = context.product || context.collection ? 18 : 0;
  const linkBoost = Math.min(10, (context.internalLinks?.length ?? 0) * 2);
  const evidenceBoost = Math.min(16, candidate.evidence.filter((item) => ["product", "collection", "internal_link"].includes(item.type)).length * 4);
  return clampScore(42 + intentBoost + catalogBoost + linkBoost + evidenceBoost);
}

function excludedKeywordCandidates(context: ContentSourceContext, plan: KeywordPlan) {
  const banned = context.brandVoice?.bannedWords ?? [];
  return plan.secondaryKeywords
    .filter((keyword) => banned.some((word) => keyword.toLowerCase().includes(word.toLowerCase())))
    .map((keyword) => ({ keyword, reason: "blocked by brand voice banned words" }));
}

function agentObjective(input: NormalizedContentPipelineInput): string {
  const growth = input.generationConfig?.seoAgent?.targetOrganicGrowthPct;
  return growth
    ? `Increase qualified organic traffic by ${growth}% with evidence-backed Shopify blog content.`
    : "Create an evidence-backed Shopify blog article that can earn qualified organic search traffic.";
}

function finalAgentStatus(stages: AgentRunStage[]): AgentStageStatus {
  if (stages.some((item) => item.status === "failed")) return "failed";
  if (stages.some((item) => item.status === "warning")) return "warning";
  return "passed";
}

function evidenceId(item: KeywordEvidenceItem): string {
  return `${item.type}:${hashString(`${item.source}:${item.value}:${item.url ?? ""}`).toString(36)}`;
}

function briefAngle(candidate: TopicCandidate): string {
  return candidate.agent?.angleKey?.replace(/_/g, " ") ?? "search opportunity";
}

function audiencePromise(candidate: TopicCandidate, keywords: KeywordPlan): string {
  return `Help search visitors understand ${keywords.primaryKeyword} through ${candidate.topic}.`;
}

function inferCompetitorAngle(title: string): string {
  const value = title.toLowerCase();
  if (/\bvs\b|compare|comparison/.test(value)) return "comparison";
  if (/gift|present/.test(value)) return "gift";
  if (/check|mistake|before/.test(value)) return "risk";
  return "editorial";
}

function inferAngleKey(topic: string): string | undefined {
  const value = topic.toLowerCase();
  if (/vs|compare|comparison|other/.test(value)) return "comparison_decision";
  if (/gift|present/.test(value)) return "gift_moment";
  if (/trend|means/.test(value)) return "trend_bridge";
  if (/check|mistake|before/.test(value)) return "mistake_avoidance";
  if (/style|commut|daily|scenario/.test(value)) return "scenario_fit";
  return undefined;
}

function unsupportedClaimSignals(body: string, signals: TrendSignal[]): string[] {
  const claims = ["guaranteed", "officially proven", "best-selling", "clinically proven"];
  const unsupported = claims.filter((claim) => body.includes(claim));
  if (body.includes("trend") && signals.length === 0) unsupported.push("trend claim without supplied trend evidence");
  return unsupported;
}

function repeatedTopicPressure(topic: string, context: ContentSourceContext): number {
  const tokens = tokenize(topic);
  return Math.round(
    Math.max(
      0,
      ...(context.recentTopics ?? [])
        .flatMap((item) => [item.topic, item.title])
        .filter((item): item is string => Boolean(item))
        .map((item) => tokenOverlap(tokens, tokenize(item)) * 40)
    )
  );
}

function tokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const hits = left.filter((token) => rightSet.has(token)).length;
  return hits / Math.min(left.length, right.length);
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3)
    )
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function average(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function funnelWeight(intent: KeywordPlan["searchIntent"]): number {
  if (intent === "transactional") return 24;
  if (intent === "commercial") return 20;
  if (intent === "informational") return 12;
  return 8;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
