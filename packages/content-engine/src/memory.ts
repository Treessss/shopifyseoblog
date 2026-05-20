import type { AgentMemorySignal, ContentSourceContext, TopicCandidateV2, TopicMemorySnapshot } from "./types";

export function buildTopicMemorySnapshot(context: ContentSourceContext, selected: TopicCandidateV2): TopicMemorySnapshot {
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
    blockedAngles,
    performanceSignals: memories.slice(0, 12).map((memory) => ({
      keyword: memory.keyword,
      angleKey: memory.angleKey,
      outcome: memory.outcome,
      confidence: memory.confidence
    }))
  };
}

export function memoryWarnings(memories: AgentMemorySignal[] | undefined, selected: TopicCandidateV2): string[] {
  if (!memories?.length) return [];

  const warnings: string[] = [];
  const activeAvoidance = memories.find(
    (memory) =>
      memory.angleKey &&
      selected.agent?.angleKey === memory.angleKey &&
      memory.avoidUntil &&
      new Date(memory.avoidUntil).getTime() > Date.now()
  );
  if (activeAvoidance) {
    warnings.push(`Selected angle ${activeAvoidance.angleKey} is inside an active avoid window from agent memory.`);
  }

  const failedSimilarKeyword = memories.find(
    (memory) =>
      memory.outcome === "failed" &&
      memory.keyword &&
      selected.primaryKeyword &&
      tokenOverlap(tokenize(memory.keyword), tokenize(selected.primaryKeyword)) >= 0.7
  );
  if (failedSimilarKeyword) {
    warnings.push(`Agent memory found a recent weak keyword pattern: ${failedSimilarKeyword.keyword}.`);
  }

  return warnings;
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

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
