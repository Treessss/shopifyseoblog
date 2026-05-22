import {
  buildDefaultDraft,
  buildKeywordEvidence,
  selectTopicCandidate
} from "./components";
import { buildMemoryStrategy, buildTopicMemorySnapshot } from "./memory";
import { planAgentTools } from "./planner";
import { defaultContentPipelineRegistry, mergeInputSeedKeywords, normalizePipelineInput, runContentPipeline } from "./registry";
import { buildCommercialSkillDoctrine } from "./skill-doctrine";
import { discoverTrendSignals } from "./trends";
import type {
  AgentContentPipelineArtifacts,
  AgentContentPipelineResult,
  AgentMemoryStrategy,
  AgentReflectionTaskDraft,
  AgentRole,
  AgentRunStage,
  AgentStageName,
  AgentStageStatus,
  AgentToolCallTrace,
  AgentToolPlan,
  ContentBrief,
  ContentPipelineInput,
  ContentPipelineRunOptions,
  ContentSourceContext,
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
  TopicSelectionResult,
  TopicSelectionResultV2,
  TrendSignal
} from "./types";

const SEO_AGENT_VERSION = "seo-agent-commercial-1.2.0";

export async function runAgentContentPipeline(
  input: ContentPipelineInput,
  context: ContentSourceContext = {},
  options: ContentPipelineRunOptions = {}
): Promise<AgentContentPipelineResult> {
  const normalized = normalizePipelineInput(input, context);
  const startedAt = nowIso();
  const runId = `seo-agent-${hashString(`${normalized.organizationId ?? ""}:${normalized.storeId ?? ""}:${normalized.topic}:${startedAt}`).toString(36)}`;
  const stages: AgentRunStage[] = [];
  const toolCalls: AgentToolCallTrace[] = [];
  const baseContext = mergeInputSeedKeywords(input, context);
  const keywordPlanner = defaultContentPipelineRegistry.getKeywordPlanner(options.keywordPlanner);
  const skillDoctrine = buildCommercialSkillDoctrine(normalized.locale);
  const toolPlan = planAgentTools(normalized, baseContext);

  const planningStageStart = nowIso();
  stages.push(
    stage(
      "tool_planning",
      "publisher_guard",
      planningStageStart,
      { objective: agentObjective(normalized), doctrineVersion: skillDoctrine.version },
      { toolPlan, skillDoctrine },
      [],
      [],
      undefined,
      "Planned the specialist SEO agents, required tools, and commercial quality doctrine.",
      [],
      toolPlan.map((plan) => plan.id)
    )
  );

  const researchStageStart = nowIso();
  const researchResult = await buildResearchBrief(normalized, baseContext, options);
  const research = researchResult.research;
  const researchContext = {
    ...baseContext,
    trendSignals: research.trendSignals,
    internalLinks: research.internalLinks,
    externalReferences: research.externalReferences,
    imageReferences: research.imageReferences,
    keywordEvidence: research.evidence
  } satisfies ContentSourceContext;
  toolCalls.push(
    traceToolCall(
      findPlan(toolPlan, "shopify_context"),
      researchStageStart,
      { sourceType: normalized.sourceType, sourceId: normalized.sourceId },
      {
        product: Boolean(baseContext.product),
        collection: Boolean(baseContext.collection),
        internalLinkCount: research.internalLinks.length,
        imageReferenceCount: research.imageReferences.length
      },
      research.evidence.filter((item) => item.type === "product" || item.type === "collection" || item.type === "internal_link"),
      []
    )
  );
  if (findPlan(toolPlan, "trend_discovery")) {
    toolCalls.push(
      traceToolCall(
        findPlan(toolPlan, "trend_discovery"),
        researchStageStart,
        { topic: normalized.topic, hotNews: normalized.generationConfig?.hotNews },
        { trendCount: research.trendSignals.length, riskFlags: research.riskFlags },
        research.evidence.filter((item) => item.type === "trend"),
        researchResult.warnings
      )
    );
  }
  if (findPlan(toolPlan, "external_citation_planner")) {
    toolCalls.push(
      traceToolCall(
        findPlan(toolPlan, "external_citation_planner"),
        researchStageStart,
        { trendCount: research.trendSignals.length, configuredMaxLinks: normalized.generationConfig?.externalReferences?.maxLinks ?? 3 },
        { externalReferenceCount: research.externalReferences.length, urls: research.externalReferences.map((reference) => reference.url) },
        research.evidence.filter((item) => item.type === "external_reference" || item.type === "trend"),
        research.externalReferences.length ? [] : ["No external citation candidate was available."]
      )
    );
  }
  stages.push(
    stage(
      "research",
      "researcher",
      researchStageStart,
      { topic: normalized.topic, sourceType: normalized.sourceType },
      research,
      research.evidence,
      researchResult.warnings,
      undefined,
      "Collected catalog facts, trend/news evidence, internal links, external citation candidates, and product image references.",
      ["tool_planning"],
      toolCalls.filter((call) => call.stage === "research").map((call) => call.id)
    )
  );

  const keywordStageStart = nowIso();
  const keywordStrategy = await buildKeywordStrategy(normalized, researchContext, research, keywordPlanner);
  toolCalls.push(
    traceToolCall(
      findPlan(toolPlan, "keyword_evidence_builder"),
      keywordStageStart,
      { topic: normalized.topic, evidenceCount: research.evidence.length },
      { primaryKeyword: keywordStrategy.primaryKeyword, clusterCount: keywordStrategy.clusters.length },
      keywordStrategy.evidenceItems ?? research.evidence,
      []
    )
  );
  const keywordCannibalizationMatchesForPlan = keywordCannibalizationMatches(keywordStrategy.primaryKeyword, baseContext);
  const keywordWarnings = keywordCannibalizationMatchesForPlan.some((item) => item.risk === "high")
    ? ["High keyword cannibalization risk found; topic must be reframed before drafting."]
    : [];
  if (findPlan(toolPlan, "keyword_cannibalization_check")) {
    toolCalls.push(
      traceToolCall(
        findPlan(toolPlan, "keyword_cannibalization_check"),
        keywordStageStart,
        {
          primaryKeyword: keywordStrategy.primaryKeyword,
          clusters: keywordStrategy.clusters.map((cluster) => cluster.name)
        },
        {
          riskCount: keywordCannibalizationMatchesForPlan.length,
          highRiskCount: keywordCannibalizationMatchesForPlan.filter((item) => item.risk === "high").length,
          matches: keywordCannibalizationMatchesForPlan.slice(0, 5).map((item) => ({
            keyword: item.keyword,
            articleId: item.articleId,
            url: item.url,
            risk: item.risk,
            overlapScore: item.overlapScore
          }))
        },
        [],
        keywordWarnings
      )
    );
  }
  stages.push(
    stage(
      "keyword_strategy",
      "keyword_planner",
      keywordStageStart,
      { topic: normalized.topic },
      keywordStrategy,
      keywordStrategy.evidenceItems ?? research.evidence,
      keywordWarnings,
      undefined,
      "Built keyword clusters and opportunity score from evidence, search intent, trends, and internal links.",
      ["research"],
      toolCalls.filter((call) => call.stage === "keyword_strategy").map((call) => call.id)
    )
  );

  const topicStageStart = nowIso();
  const topicSelection = context.topicSelection ?? selectTopicCandidate({ ...normalized, primaryKeyword: normalized.primaryKeyword ?? keywordStrategy.primaryKeyword }, researchContext);
  const topicSelectionV2 = buildTopicSelectionV2(topicSelection, keywordStrategy, researchContext);
  const memoryStrategy = buildMemoryStrategy(baseContext, topicSelectionV2.selected);
  const minOpportunityScore = normalized.generationConfig?.seoAgent?.minOpportunityScore ?? 70;
  const opportunityWarnings =
    topicSelectionV2.selected.scoring.opportunity < minOpportunityScore
      ? [`Selected topic opportunity score ${topicSelectionV2.selected.scoring.opportunity} is below configured minimum ${minOpportunityScore}.`]
      : [];
  const topicWarnings = [...opportunityWarnings, ...memoryStrategy.warnings];
  const topicContext = {
    ...researchContext,
    topic: topicSelectionV2.selected.topic,
    topicSelection,
    keywordEvidence: topicSelectionV2.selected.evidence,
    memoryStrategy
  } satisfies ContentSourceContext;
  toolCalls.push(
    traceToolCall(
      findPlan(toolPlan, "topic_opportunity_ranker"),
      topicStageStart,
      { candidateCount: topicSelection.candidates.length, minOpportunityScore },
      {
        selectedTopic: topicSelectionV2.selected.topic,
        selectedAngle: topicSelectionV2.selected.agent?.angleKey,
        opportunity: topicSelectionV2.selected.scoring.opportunity
      },
      topicSelectionV2.selected.evidence,
      topicWarnings
    ),
    traceToolCall(
      findPlan(toolPlan, "memory_strategy"),
      topicStageStart,
      {
        memoryCount: baseContext.agentMemories?.length ?? 0,
        recentTopicCount: baseContext.recentTopics?.length ?? 0,
        selectedTopic: topicSelectionV2.selected.topic,
        selectedAngle: topicSelectionV2.selected.agent?.angleKey
      },
      {
        riskScore: memoryStrategy.riskScore,
        recommendationCount: memoryStrategy.recommendations.length,
        guidanceCount: memoryStrategy.guidance.length,
        blockedAngles: memoryStrategy.blockedAngles,
        recommendations: memoryStrategy.recommendations
      },
      [],
      memoryStrategy.warnings
    )
  );
  stages.push(
    stage(
      "topic_selection",
      "topic_strategist",
      topicStageStart,
      { candidateCount: topicSelection.candidates.length, minOpportunityScore },
      topicSelectionV2,
      topicSelectionV2.selected.evidence,
      topicWarnings,
      opportunityWarnings.length ? "failed" : undefined,
      `Selected ${topicSelectionV2.selected.agent?.angleKey ?? "topic"} after scoring opportunity, novelty, commerce fit, and memory risk.`,
      ["keyword_strategy", "research"],
      toolCalls.filter((call) => call.stage === "topic_selection").map((call) => call.id)
    )
  );

  const briefStageStart = nowIso();
  const contentBrief = buildContentBrief(normalized, topicContext, keywordStrategy, topicSelectionV2, research);
  toolCalls.push(
    traceToolCall(
      findPlan(toolPlan, "content_brief_builder"),
      briefStageStart,
      { topic: topicSelectionV2.selected.topic, doctrineVersion: skillDoctrine.version },
      {
        outlineCount: contentBrief.outline.length,
        internalLinkCount: contentBrief.internalLinkPlan.length,
        externalCitationCount: contentBrief.externalCitationPlan.length,
        memoryGuidanceCount: contentBrief.memoryGuidance.length,
        requiredModules: skillDoctrine.requiredArticleModules
      },
      topicSelectionV2.selected.evidence,
      []
    )
  );
  stages.push(
    stage(
      "content_brief",
      "writer",
      briefStageStart,
      { topic: topicSelectionV2.selected.topic },
      contentBrief,
      topicSelectionV2.selected.evidence,
      [],
      undefined,
      "Converted the selected opportunity into an evidence-backed brief with required SEO modules.",
      ["topic_selection", "keyword_strategy"],
      toolCalls.filter((call) => call.stage === "content_brief").map((call) => call.id)
    )
  );

  const resolvedInput = {
    ...input,
    topic: topicSelectionV2.selected.topic,
    primaryKeyword: input.primaryKeyword ?? topicSelectionV2.selected.primaryKeyword
  } satisfies ContentPipelineInput;

  const draftStageStart = nowIso();
  const pipelineResult = await runContentPipeline(resolvedInput, topicContext, options);
  toolCalls.push(
    traceToolCall(
      findPlan(toolPlan, "article_generator"),
      draftStageStart,
      { topic: topicSelectionV2.selected.topic, primaryKeyword: topicSelectionV2.selected.primaryKeyword },
      {
        title: pipelineResult.article.title,
        seoScore: pipelineResult.article.seoScore,
        qualityPassed: pipelineResult.article.qualityPassed
      },
      pipelineResult.artifacts.keywordEvidence ?? topicSelectionV2.selected.evidence,
      pipelineResult.article.qualityPassed ? [] : pipelineResult.artifacts.quality.reasons
    )
  );
  if (findPlan(toolPlan, "image_prompt_director")) {
    toolCalls.push(
      traceToolCall(
        findPlan(toolPlan, "image_prompt_director"),
        draftStageStart,
        { imageReferenceCount: topicContext.imageReferences?.length ?? 0 },
        { imagePrompt: pipelineResult.article.imagePrompt, imageAlt: pipelineResult.article.imageAlt },
        [],
        pipelineResult.article.imagePrompt ? [] : ["Image prompt was not produced by the content engine."]
      )
    );
  }
  stages.push(
    stage(
      "draft_generation",
      "writer",
      draftStageStart,
      { topic: topicSelectionV2.selected.topic, primaryKeyword: topicSelectionV2.selected.primaryKeyword },
      {
        title: pipelineResult.article.title,
        handle: pipelineResult.article.handle,
        seoScore: pipelineResult.article.seoScore,
        qualityPassed: pipelineResult.article.qualityPassed
      },
      pipelineResult.artifacts.keywordEvidence ?? topicSelectionV2.selected.evidence,
      pipelineResult.article.qualityPassed ? [] : pipelineResult.artifacts.quality.reasons,
      undefined,
      "Generated the first Shopify HTML draft from the brief and quality doctrine.",
      ["content_brief"],
      toolCalls.filter((call) => call.stage === "draft_generation").map((call) => call.id)
    )
  );

  const reflectionStageStart = nowIso();
  const reflection = buildReflectionReport(pipelineResult, contentBrief, keywordStrategy, topicContext, topicSelectionV2, normalized);
  const reflectionTasks = buildReflectionTasks(reflection, pipelineResult.artifacts.keywordEvidence ?? topicSelectionV2.selected.evidence);
  toolCalls.push(
    traceToolCall(
      findPlan(toolPlan, "expert_panel_reflection"),
      reflectionStageStart,
      { minSeoScore: normalized.generationConfig?.qualityGate?.minSeoScore ?? 78 },
      {
        publishDecision: reflection.publishDecision,
        revisionCount: reflection.revisions.length,
        taskCount: reflectionTasks.length
      },
      pipelineResult.artifacts.keywordEvidence ?? topicSelectionV2.selected.evidence,
      reflection.revisions.map((revision) => revision.instruction)
    )
  );
  stages.push(
    stage(
      "quality_reflection",
      "seo_editor",
      reflectionStageStart,
      { minSeoScore: normalized.generationConfig?.qualityGate?.minSeoScore ?? 78 },
      reflection,
      pipelineResult.artifacts.keywordEvidence ?? topicSelectionV2.selected.evidence,
      reflection.revisions.map((revision) => revision.instruction),
      reflection.publishDecision === "reject" ? "failed" : reflection.publishDecision === "revise" ? "warning" : "passed",
      `Quality gate decided ${reflection.publishDecision}; created ${reflectionTasks.length} reflection task(s).`,
      ["draft_generation", "content_brief"],
      toolCalls.filter((call) => call.stage === "quality_reflection").map((call) => call.id)
    )
  );

  const finishedAt = nowIso();
  const memory = buildTopicMemorySnapshot(topicContext, topicSelectionV2.selected);
  const agentRun: SeoAgentRun = {
    runId,
    agentVersion: SEO_AGENT_VERSION,
    mode: normalized.generationConfig?.seoAgent?.agentMode ?? "commercial",
    objective: agentObjective(normalized),
    startedAt,
    finishedAt,
    status: finalAgentStatus(stages),
    stages,
    toolPlan,
    toolCalls,
    reflectionTasks,
    skillDoctrine,
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

  const externalReferences = buildExternalReferences(input, context, trendSignals);
  const evidenceContext = { ...context, trendSignals, externalReferences } satisfies ContentSourceContext;
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
    externalReferences,
    imageReferences: context.imageReferences ?? [],
    keywordCannibalization: context.keywordCannibalization ?? [],
    evidence,
    riskFlags: researchRiskFlags(input, evidenceContext, trendSignals),
    sourceSummary: {
      trendCount: trendSignals.length,
      internalLinkCount: context.internalLinks?.length ?? 0,
      externalReferenceCount: externalReferences.length,
      imageReferenceCount: context.imageReferences?.length ?? 0,
      recentTopicCount: context.recentTopics?.length ?? 0,
      cannibalizationRiskCount: (context.keywordCannibalization ?? []).filter((item) => item.risk !== "low").length
    }
  };

  if (trendSignals.length === 0 && input.generationConfig?.hotNews?.enabled) {
    warnings.push("No usable trend/news signal was found; using evergreen catalog evidence.");
  }
  if (research.riskFlags.length > 0) warnings.push(...research.riskFlags);

  return { research, warnings };
}

function buildExternalReferences(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext,
  trendSignals: TrendSignal[]
): NonNullable<ContentSourceContext["externalReferences"]> {
  if (input.generationConfig?.externalReferences?.enabled === false) return [];

  const maxLinks = input.generationConfig?.externalReferences?.maxLinks ?? 3;
  const query =
    firstNonBlank(input.primaryKeyword, input.topic, context.product?.productType, context.collection?.title, context.product?.title) ??
    "Shopify ecommerce";
  const fromContext = context.externalReferences ?? [];
  const fromTrends = trendSignals
    .filter((signal) => Boolean(signal.url))
    .map((signal) => ({
      title: signal.title,
      url: signal.url as string,
      source: signal.source || "trend feed",
      snippet: signal.summary,
      publishedAt: signal.publishedAt,
      reason: "trend/news context for article angle",
      relevanceScore: signal.relevanceScore
    }));
  const fallback = {
    title: `Google Trends for ${query}`,
    url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
    source: "Google Trends",
    reason: "search demand cross-check",
    relevanceScore: 1
  };

  const seen = new Set<string>();
  const output: NonNullable<ContentSourceContext["externalReferences"]> = [];
  for (const reference of [...fromContext, ...fromTrends, fallback]) {
    if (!isExternalUrl(reference.url)) continue;
    const key = normalizeReferenceUrl(reference.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(reference);
    if (output.length >= maxLinks) break;
  }
  return output;
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
  const cannibalizationPenalty = keywordCannibalizationPressure(plan.primaryKeyword, context);
  const opportunityScore = clampScore(evidenceConfidence * 0.55 + funnelWeight(plan.searchIntent) + trendBoost + linkBoost - cannibalizationPenalty);
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
  const externalCitationPlan = research.externalReferences.slice(0, input.generationConfig?.externalReferences?.maxLinks ?? 3).map((reference, index) => ({
    url: reference.url,
    title: reference.title,
    source: reference.source,
    placement: index === 0 ? "answer or evidence section" : "supporting context or reference section"
  }));
  const memoryGuidance = (context.memoryStrategy?.guidance ?? []).slice(0, 6);

  return {
    titleDirection: topicSelection.selected.topic,
    primaryKeyword: keywords.primaryKeyword,
    searchIntent: keywords.searchIntent,
    audienceNeed: keywords.audienceNeed,
    outline: draft.sections,
    mustUseEvidenceIds: research.evidence.slice(0, 6).map(evidenceId),
    internalLinkPlan,
    externalCitationPlan,
    imageBrief: {
      prompt: draft.imagePrompt ?? `${keywords.primaryKeyword} ecommerce editorial image`,
      alt: draft.imageAlt ?? keywords.primaryKeyword,
      references: imageReferences
    },
    memoryGuidance,
    claimsPolicy: [
      "Use trend/news signals only as editorial angles, not as unsupported claims.",
      "Use Shopify product facts as the source of product-specific truth.",
      "Do not invent discounts, availability, materials, certifications, or compatibility details.",
      ...(research.keywordCannibalization.some((item) => item.risk !== "low")
        ? ["Avoid targeting the same primary keyword as an existing article; reframe the search intent, title promise, and internal-link path."]
        : []),
      ...(memoryGuidance.length ? ["Follow long-term memory guidance so the article does not repeat failed topics, weak keyword patterns, or stale guide formulas."] : [])
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
  const missingExternalCitations = brief.externalCitationPlan.filter((link) => !article.bodyHtml.includes(link.url)).map((link) => link.url);
  const missingEvidenceIds = brief.mustUseEvidenceIds.filter((id) => {
    const item = (pipelineResult.artifacts.keywordEvidence ?? []).find((evidence) => evidenceId(evidence) === id);
    if (!item) return false;
    return !body.includes(item.value.toLowerCase().slice(0, 28));
  });
  const unsupportedClaims = unsupportedClaimSignals(body, context.trendSignals ?? []);
  const memoryViolations = memoryComplianceViolations(article.title, body, context.memoryStrategy);
  const revisions: ReflectionReport["revisions"] = [];

  if (pipelineResult.artifacts.seo.score < (pipelineResult.artifacts.quality.minSeoScore ?? 78)) {
    revisions.push({ priority: "P0", instruction: "Raise SEO score by improving title, summary, H2 keyword coverage, and internal semantic depth." });
  }
  if (missingLinks.length > 0) {
    revisions.push({ priority: "P1", instruction: `Add missing internal links where useful: ${missingLinks.slice(0, 3).join(", ")}` });
  }
  if (missingExternalCitations.length > 0 && input.generationConfig?.externalReferences?.enabled !== false) {
    revisions.push({
      priority: "P1",
      instruction: `Add missing external citations from the approved reference plan: ${missingExternalCitations.slice(0, 3).join(", ")}`
    });
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
  if (memoryViolations.length > 0) {
    revisions.push({
      priority: context.memoryStrategy && context.memoryStrategy.riskScore >= 75 ? "P0" : "P1",
      instruction: `Revise against long-term agent memory: ${memoryViolations.slice(0, 2).join(" ")}`
    });
  }

  const factualityPassed = unsupportedClaims.length === 0;
  const memoryPassed = memoryViolations.length === 0;
  const passed =
    pipelineResult.artifacts.quality.passed &&
    factualityPassed &&
    memoryPassed &&
    revisions.filter((revision) => revision.priority === "P0").length === 0;
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
    memoryCompliance: {
      passed: memoryPassed,
      violations: memoryViolations,
      appliedGuidance: brief.memoryGuidance.map((item) => item.instruction)
    },
    revisions,
    summary: passed
      ? "Article passed the commercial SEO agent reflection gate."
      : "Article needs revision before it should be treated as a high-confidence organic traffic asset."
  };
}

function stage<TInput, TOutput>(
  name: AgentStageName,
  agentRole: AgentRole,
  startedAt: string,
  input: TInput,
  output: TOutput,
  evidence: KeywordEvidenceItem[] = [],
  warnings: string[] = [],
  forcedStatus?: AgentStageStatus,
  decision?: string,
  inputRefs: string[] = [],
  toolCallIds: string[] = []
): AgentRunStage<TInput, TOutput> {
  return {
    id: `${name}-${hashString(`${name}:${startedAt}:${JSON.stringify(input).slice(0, 200)}`).toString(36)}`,
    stage: name,
    agentRole,
    status: forcedStatus ?? (warnings.length ? "warning" : "passed"),
    input,
    output,
    evidence: evidence.slice(0, 12),
    warnings,
    decision,
    inputRefs,
    outputRefs: [`${name}.output`],
    toolCallIds,
    startedAt,
    finishedAt: nowIso(),
    agentVersion: SEO_AGENT_VERSION
  };
}

function traceToolCall(
  plan: AgentToolPlan | undefined,
  startedAt: string,
  input: unknown,
  output: unknown,
  evidence: KeywordEvidenceItem[],
  warnings: string[]
): AgentToolCallTrace {
  const finishedAt = nowIso();
  return {
    id: `tool-${hashString(`${plan?.id ?? "ad-hoc"}:${startedAt}:${JSON.stringify(input).slice(0, 200)}`).toString(36)}`,
    planId: plan?.id,
    stage: plan?.stage ?? "research",
    agentRole: plan?.agentRole ?? "researcher",
    toolName: plan?.toolName ?? "ad_hoc_tool",
    purpose: plan?.purpose ?? "Ad-hoc agent tool execution.",
    status: warnings.length ? "warning" : "passed",
    input,
    output,
    evidence: evidence.slice(0, 12),
    evidenceIds: evidence.slice(0, 12).map(evidenceId),
    warnings,
    decisionSummary: summarizeToolDecision(plan?.toolName ?? "ad_hoc_tool", output, warnings),
    startedAt,
    finishedAt,
    latencyMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
  };
}

function findPlan(toolPlan: AgentToolPlan[], toolName: string): AgentToolPlan | undefined {
  return toolPlan.find((plan) => plan.toolName === toolName);
}

function summarizeToolDecision(toolName: string, output: unknown, warnings: string[]): string {
  if (warnings.length > 0) return `${toolName} completed with ${warnings.length} warning(s).`;
  if (!isRecord(output)) return `${toolName} completed.`;
  if (typeof output.selectedTopic === "string") return `Selected topic: ${output.selectedTopic}.`;
  if (typeof output.primaryKeyword === "string") return `Primary keyword: ${output.primaryKeyword}.`;
  if (typeof output.publishDecision === "string") return `Publish decision: ${output.publishDecision}.`;
  if (typeof output.riskScore === "number") return `Memory risk score: ${output.riskScore}.`;
  if (typeof output.externalReferenceCount === "number") return `Approved ${output.externalReferenceCount} external reference(s).`;
  return `${toolName} completed.`;
}

function buildReflectionTasks(reflection: ReflectionReport, evidence: KeywordEvidenceItem[]): AgentReflectionTaskDraft[] {
  return reflection.revisions.map((revision) => ({
    priority: revision.priority,
    agentRole: revision.priority === "P0" ? "seo_editor" : "writer",
    instruction: revision.instruction,
    acceptanceCheck:
      revision.priority === "P0"
        ? "The article is regenerated or revised and the next quality reflection no longer reports this P0 issue."
        : "The requested edit is visible in the article and supported by supplied evidence.",
    evidenceIds: evidence.slice(0, 6).map(evidenceId),
    status: "open"
  }));
}

function memoryComplianceViolations(title: string, body: string, strategy: AgentMemoryStrategy | undefined): string[] {
  if (!strategy?.guidance.length) return [];

  const text = `${title} ${body}`.toLowerCase();
  const violations: string[] = [];
  for (const guidance of strategy.guidance) {
    if (guidance.priority === "P2") continue;
    if (guidance.source === "avoid_window") {
      violations.push("Selected angle is still inside an active avoid window; the draft needs a materially different framing before publish.");
      continue;
    }
    if (guidance.source === "failed_keyword" && guidance.evidence && tokenOverlap(tokenize(text), tokenize(guidance.evidence)) >= 0.45) {
      violations.push(`Draft still leans on a previously weak keyword/topic pattern: ${guidance.evidence}.`);
      continue;
    }
    if (guidance.source === "recent_topic" && guidance.evidence && tokenOverlap(tokenize(title), tokenize(guidance.evidence)) >= 0.45) {
      violations.push(`Title remains too close to a recent topic: ${guidance.evidence}.`);
    }
  }

  return Array.from(new Set(violations)).slice(0, 4);
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
  if ((context.keywordCannibalization ?? []).some((item) => item.risk === "high")) flags.push("keyword_cannibalization_map_has_high_risk");
  return flags;
}

function topicRiskFlags(candidate: TopicCandidate, context: ContentSourceContext): string[] {
  const flags: string[] = [];
  if (!candidate.evidence.some((item) => item.type === "trend") && context.generationConfig?.qualityGate?.requireTrendEvidence) {
    flags.push("required_trend_evidence_missing");
  }
  if (repeatedTopicPressure(candidate.topic, context) >= 28) flags.push("recent_topic_similarity_high");
  if (keywordCannibalizationPressure(candidate.primaryKeyword, context) >= 24 || keywordCannibalizationPressure(candidate.topic, context) >= 28) {
    flags.push("keyword_cannibalization_high");
  }
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
  const bannedKeywords = plan.secondaryKeywords
    .filter((keyword) => banned.some((word) => keyword.toLowerCase().includes(word.toLowerCase())))
    .map((keyword) => ({ keyword, reason: "blocked by brand voice banned words" }));
  const cannibalizedKeywords = [plan.primaryKeyword, ...plan.secondaryKeywords, ...plan.longTailKeywords].flatMap((keyword) =>
    keywordCannibalizationMatches(keyword, context)
      .filter((match) => match.risk !== "low")
      .map((match) => ({
        keyword,
        reason: `keyword cannibalization risk with existing article "${match.title ?? match.keyword}"`
      }))
  );
  return uniqueKeywordExclusions([...bannedKeywords, ...cannibalizedKeywords]);
}

function keywordCannibalizationPressure(value: string, context: ContentSourceContext): number {
  const matches = keywordCannibalizationMatches(value, context);
  if (matches.length === 0) return 0;

  return Math.max(
    ...matches.map((match) => {
      const riskWeight = match.risk === "high" ? 36 : match.risk === "medium" ? 22 : 8;
      return Math.round(riskWeight * Math.max(match.overlapScore, tokenOverlap(tokenize(value), tokenize(match.keyword))));
    })
  );
}

function keywordCannibalizationMatches(value: string, context: ContentSourceContext) {
  const tokens = tokenize(value);
  return (context.keywordCannibalization ?? [])
    .map((signal) => {
      const overlapScore = Math.max(signal.overlapScore, tokenOverlap(tokens, tokenize(signal.keyword)));
      return { ...signal, overlapScore };
    })
    .filter((signal) => signal.overlapScore >= 0.45 || signal.risk === "high")
    .sort((left, right) => {
      const riskRank = (risk: "low" | "medium" | "high") => (risk === "high" ? 3 : risk === "medium" ? 2 : 1);
      return riskRank(right.risk) - riskRank(left.risk) || right.overlapScore - left.overlapScore;
    })
    .slice(0, 8);
}

function uniqueKeywordExclusions(items: Array<{ keyword: string; reason: string }>) {
  const seen = new Set<string>();
  const output: Array<{ keyword: string; reason: string }> = [];

  for (const item of items) {
    const key = `${item.keyword.toLowerCase()}|${item.reason.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
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

function firstNonBlank(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExternalUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeReferenceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.hostname.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
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
