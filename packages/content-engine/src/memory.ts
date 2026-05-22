import type {
  AgentMemoryGuidance,
  AgentMemoryMatchedSignal,
  AgentMemorySignal,
  AgentMemoryStrategy,
  ContentSourceContext,
  TopicCandidateV2,
  TopicMemorySnapshot
} from "./types";

export function buildTopicMemorySnapshot(context: ContentSourceContext, selected: TopicCandidateV2): TopicMemorySnapshot {
  const strategy = context.memoryStrategy ?? buildMemoryStrategy(context, selected);
  const lastTopics = (context.recentTopics ?? [])
    .flatMap((item) => [item.topic, item.title])
    .filter((item): item is string => Boolean(item))
    .slice(0, 12);
  const memories = context.agentMemories ?? [];
  const learnedRules = unique(
    memories
      .map((memory) => memory.learnedRule)
      .filter((rule): rule is string => Boolean(rule))
      .slice(0, 12)
  );
  const blockedAngles = unique(
    memories
      .filter((memory) => memory.avoidUntil && new Date(memory.avoidUntil).getTime() > Date.now())
      .map((memory) => memory.angleKey)
      .filter((angle): angle is string => Boolean(angle))
  );

  return {
    recentTopicCount: context.recentTopics?.length ?? 0,
    repeatedTopicCount: lastTopics.filter((topic) => tokenOverlap(tokenize(topic), tokenize(selected.topic)) >= 0.72).length,
    avoidedAngles: unique(lastTopics.map(inferAngleKey).filter((item): item is string => Boolean(item))),
    lastTopics,
    learnedRules,
    blockedAngles: strategy.blockedAngles.length ? strategy.blockedAngles : blockedAngles,
    recommendations: strategy.recommendations,
    riskScore: strategy.riskScore,
    reusePatterns: strategy.reusePatterns,
    performanceSignals: memories.slice(0, 12).map((memory) => ({
      keyword: memory.keyword,
      angleKey: memory.angleKey,
      outcome: memory.outcome,
      confidence: memory.confidence
    })),
    matchedSignals: strategy.matchedSignals
  };
}

export function memoryWarnings(memories: AgentMemorySignal[] | undefined, selected: TopicCandidateV2): string[] {
  return buildMemoryStrategy({ agentMemories: memories }, selected).warnings;
}

export function buildMemoryStrategy(context: ContentSourceContext, selected: TopicCandidateV2): AgentMemoryStrategy {
  const memories = context.agentMemories ?? [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const guidance: AgentMemoryGuidance[] = [];
  const matchedSignals: AgentMemoryMatchedSignal[] = [];
  const reusePatterns: AgentMemoryStrategy["reusePatterns"] = [];
  const selectedAngle = selected.agent?.angleKey;
  let riskScore = repeatedTopicRisk(context, selected);

  const activeAvoidance = memories.filter(
    (memory) =>
      memory.angleKey &&
      selectedAngle === memory.angleKey &&
      memory.avoidUntil &&
      new Date(memory.avoidUntil).getTime() > Date.now()
  );
  for (const memory of activeAvoidance.slice(0, 3)) {
    const severity = memory.confidence >= 80 ? "high" : "medium";
    warnings.push(`Selected angle ${memory.angleKey} is inside an active avoid window from agent memory.`);
    recommendations.push(`Switch away from ${memory.angleKey} or rebuild it with a materially different shopper scenario, title frame, and evidence set.`);
    guidance.push({
      priority: severity === "high" ? "P0" : "P1",
      source: "avoid_window",
      instruction: `Do not reuse the previous ${memory.angleKey} angle unless the article has a clearly different buyer scenario, evidence set, title pattern, and internal-link path.`,
      reason: memory.learnedRule ?? "A previous run asked the agent to avoid this angle temporarily.",
      evidence: memory.keyword ?? memory.topic
    });
    matchedSignals.push(memorySignal("avoid_window", memory, severity));
    riskScore += weightedRisk(memory, severity === "high" ? 30 : 22);
  }

  const failedSimilarKeywords = memories.filter(
    (memory) =>
      ["failed", "rejected", "warning"].includes(memory.outcome) &&
      memory.keyword &&
      selected.primaryKeyword &&
      tokenOverlap(tokenize(memory.keyword), tokenize(selected.primaryKeyword)) >= 0.7
  );
  for (const memory of failedSimilarKeywords.slice(0, 3)) {
    const severity = memory.confidence >= 80 || memory.outcome === "failed" ? "high" : "medium";
    warnings.push(`Agent memory found a recent weak keyword pattern: ${memory.keyword}.`);
    recommendations.push(`Keep ${selected.primaryKeyword} only if the article adds a new search intent, sharper comparison, or stronger product evidence than the failed run.`);
    guidance.push({
      priority: severity === "high" ? "P1" : "P2",
      source: "failed_keyword",
      instruction: `Avoid the old ${memory.keyword} pattern: add a fresher angle, concrete use case, and stronger decision criteria before drafting.`,
      reason: memory.learnedRule ?? "A similar keyword recently underperformed or failed quality review.",
      evidence: memory.topic ?? memory.keyword
    });
    matchedSignals.push(memorySignal("failed_keyword", memory, severity));
    riskScore += weightedRisk(memory, severity === "high" ? 24 : 14);
  }

  const successfulPatterns = memories.filter(
    (memory) =>
      ["success", "published"].includes(memory.outcome) &&
      memory.confidence >= 70 &&
      (memory.angleKey === selectedAngle ||
        (memory.keyword && selected.primaryKeyword && tokenOverlap(tokenize(memory.keyword), tokenize(selected.primaryKeyword)) >= 0.45))
  );
  for (const memory of successfulPatterns.slice(0, 3)) {
    const instruction = `Borrow the successful ${memory.angleKey ?? "topic"} pattern only as a structure cue; keep the headline, scenario, and evidence fresh.`;
    recommendations.push(instruction);
    guidance.push({
      priority: "P2",
      source: "success_pattern",
      instruction,
      reason: memory.learnedRule ?? "A related memory has a successful or published outcome.",
      evidence: memory.keyword ?? memory.topic
    });
    reusePatterns.push({ keyword: memory.keyword, angleKey: memory.angleKey, instruction, confidence: memory.confidence });
    matchedSignals.push(memorySignal("success_pattern", memory, "low"));
  }

  const repeatedTopics = (context.recentTopics ?? [])
    .flatMap((item) => [item.topic, item.title])
    .filter((item): item is string => Boolean(item))
    .filter((topic) => tokenOverlap(tokenize(topic), tokenize(selected.topic)) >= 0.72);
  if (repeatedTopics.length > 0) {
    warnings.push(`Selected topic overlaps ${repeatedTopics.length} recent topic(s).`);
    recommendations.push("Make the article visibly different: new search intent, new opening promise, new examples, and new internal-link target.");
    guidance.push({
      priority: repeatedTopics.length > 1 ? "P1" : "P2",
      source: "recent_topic",
      instruction: "Do not reuse the previous guide formula; change the buyer moment, examples, section order, and title framing.",
      reason: "Recent topic history is too similar to the selected topic.",
      evidence: repeatedTopics[0]
    });
    matchedSignals.push({
      type: "recent_topic",
      topic: repeatedTopics[0],
      confidence: Math.min(95, 65 + repeatedTopics.length * 10),
      severity: repeatedTopics.length > 1 ? "medium" : "low"
    });
    riskScore += Math.min(26, repeatedTopics.length * 12);
  }

  const learnedRuleGuidance = unique(
    memories
      .map((memory) => memory.learnedRule)
      .filter((rule): rule is string => Boolean(rule))
      .slice(0, 5)
  );
  for (const rule of learnedRuleGuidance.slice(0, 3)) {
    guidance.push({
      priority: "P2",
      source: "learned_rule",
      instruction: rule,
      reason: "Long-term agent memory rule from previous runs."
    });
  }

  if (warnings.length === 0 && reusePatterns.length === 0 && learnedRuleGuidance.length === 0) {
    recommendations.push("No strong historical constraint found; prioritize fresh trend evidence and a non-repeating shopper scenario.");
  }

  return {
    warnings: unique(warnings),
    recommendations: unique(recommendations).slice(0, 8),
    guidance: dedupeGuidance(guidance).slice(0, 8),
    riskScore: clampScore(riskScore),
    blockedAngles: unique(
      memories
        .filter((memory) => memory.angleKey && memory.avoidUntil && new Date(memory.avoidUntil).getTime() > Date.now())
        .map((memory) => memory.angleKey as string)
    ),
    reusePatterns,
    matchedSignals
  };
}

function inferAngleKey(topic: string): string | undefined {
  const value = topic.toLowerCase();
  if (/vs|compare|comparison|other/.test(value)) return "comparison_decision";
  if (/gift|present/.test(value)) return "gift_moment";
  if (/trend|means|趋势|热点/.test(value)) return "trend_bridge";
  if (/check|mistake|before|购买前/.test(value)) return "mistake_avoidance";
  if (/style|commut|daily|scenario|场景|搭配/.test(value)) return "scenario_fit";
  return undefined;
}

function tokenize(value: string): string[] {
  return unique(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function tokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const hits = left.filter((token) => rightSet.has(token)).length;
  return hits / Math.min(left.length, right.length);
}

function repeatedTopicRisk(context: ContentSourceContext, selected: TopicCandidateV2): number {
  const topicTokens = tokenize(selected.topic);
  const maxOverlap = Math.max(
    0,
    ...(context.recentTopics ?? [])
      .flatMap((item) => [item.topic, item.title])
      .filter((item): item is string => Boolean(item))
      .map((topic) => tokenOverlap(topicTokens, tokenize(topic)))
  );
  return Math.round(maxOverlap * 28);
}

function weightedRisk(memory: AgentMemorySignal, base: number): number {
  const confidence = Math.max(0, Math.min(100, memory.confidence)) / 100;
  const scorePenalty =
    memory.qualityScore && memory.qualityScore < 82 ? Math.min(10, Math.round((82 - memory.qualityScore) / 2)) : 0;
  return Math.round(base * (0.55 + confidence * 0.45)) + scorePenalty;
}

function memorySignal(
  type: AgentMemoryMatchedSignal["type"],
  memory: AgentMemorySignal,
  severity: AgentMemoryMatchedSignal["severity"]
): AgentMemoryMatchedSignal {
  return {
    type,
    keyword: memory.keyword,
    topic: memory.topic,
    angleKey: memory.angleKey,
    outcome: memory.outcome,
    confidence: memory.confidence,
    severity
  };
}

function dedupeGuidance(items: AgentMemoryGuidance[]): AgentMemoryGuidance[] {
  const seen = new Set<string>();
  const output: AgentMemoryGuidance[] = [];
  for (const item of items) {
    const key = `${item.source}:${item.instruction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
