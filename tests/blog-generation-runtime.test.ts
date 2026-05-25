import { describe, expect, it } from "vitest";
import {
  buildAgentMemoryPersistenceData,
  buildAgentStepRows,
  buildGenerationProgressPayload,
  buildKeywordCannibalizationSignals,
  clampMemoryWindowDays,
  mergeGenerationProgressPayload,
  selectAgentMemoryRows
} from "../apps/worker/src/processors/blog-generation";

describe("blog generation runtime helpers", () => {
  it("keeps generation progress monotonic and records stale updates", () => {
    const first = buildGenerationProgressPayload(
      { step: "article:saving", label: "Saving", percent: 88, status: "ready_to_publish" },
      "job-1",
      "2026-05-22T10:00:00.000Z"
    );
    const container = mergeGenerationProgressPayload({ existing: true }, first);
    const stale = buildGenerationProgressPayload(
      { step: "ai:reviewing", label: "Reviewing", percent: 60 },
      "job-1",
      "2026-05-22T10:01:00.000Z"
    );
    const merged = mergeGenerationProgressPayload(container, stale);
    const progress = merged.generationProgress as Record<string, unknown>;

    expect(progress.percent).toBe(88);
    expect(progress.step).toBe("article:saving");
    expect(progress.updatedAt).toBe("2026-05-22T10:01:00.000Z");
    expect(progress.staleUpdate).toMatchObject({ step: "ai:reviewing", percent: 60, stale: true });
    expect(progress.history).toMatchObject([
      { step: "article:saving", percent: 88 },
      { step: "ai:reviewing", percent: 60, stale: true }
    ]);
    expect(merged.existing).toBe(true);
  });

  it("allows retry and failure progress to regress intentionally", () => {
    const container = mergeGenerationProgressPayload(
      {},
      buildGenerationProgressPayload({ step: "article:saving", label: "Saving", percent: 88 }, "job-1")
    );
    const retry = mergeGenerationProgressPayload(
      container,
      buildGenerationProgressPayload({
        step: "article:generation_retry_scheduled",
        label: "Retrying",
        percent: 20,
        status: "retrying"
      })
    );
    const progress = retry.generationProgress as Record<string, unknown>;

    expect(progress.percent).toBe(20);
    expect(progress.step).toBe("article:generation_retry_scheduled");
    expect(progress.previousStep).toBe("article:saving");
  });

  it("deduplicates agent memories and prioritizes active avoid windows", () => {
    const now = new Date("2026-05-22T10:00:00.000Z");
    const rows = [
      memoryRow({
        id: "low",
        confidence: 20,
        outcome: "success",
        qualityScore: null,
        trafficScore: null,
        lastUsedAt: new Date("2026-05-01T00:00:00.000Z")
      }),
      memoryRow({ id: "active", confidence: 45, outcome: "warning", avoidUntil: new Date("2026-05-23T00:00:00.000Z") }),
      memoryRow({ id: "duplicate", confidence: 90, outcome: "failed", lastUsedAt: new Date("2026-05-21T00:00:00.000Z") }),
      memoryRow({ id: "duplicate-old", confidence: 70, outcome: "failed", lastUsedAt: new Date("2026-05-10T00:00:00.000Z") })
    ];

    const selected = selectAgentMemoryRows(rows, 10, now);

    expect(selected.map((row) => row.id)).toContain("active");
    expect(selected.map((row) => row.id)).toContain("duplicate");
    expect(selected.map((row) => row.id)).not.toContain("duplicate-old");
    expect(selected.map((row) => row.id)).not.toContain("low");
  });

  it("builds compressed agent memory persistence data", () => {
    const data = buildAgentMemoryPersistenceData({
      agentRunId: "run-1",
      articleId: "article-1",
      campaignId: "campaign-1",
      organizationId: "org-1",
      storeId: "store-1",
      locale: "en-US",
      sourceType: "product",
      sourceId: "source-1",
      qualityPassed: false,
      finalSeoScore: 74,
      finalTrafficScore: 69,
      agentRun: {
        status: "warning",
        keywordStrategy: { primaryKeyword: "Clear Phone Case" },
        topicSelection: {
          selected: {
            topic: "Clear Phone Case for Desk Setups",
            agent: { angleKey: "scenario_fit" },
            evidence: [{ type: "seed_keyword", source: "manual", label: "seed", value: "clear phone case", confidence: 80 }]
          }
        },
        reflection: { publishDecision: "revise" },
        memory: { riskScore: 42 }
      } as any
    });

    expect(data.sourceId).toBe("source-1");
    expect(data.topicFingerprint).toBe("clear phone case for desk setups");
    expect(data.outcome).toBe("warning");
    expect(data.avoidUntil).toBeInstanceOf(Date);
    expect(data.learnedRule).toContain("Avoid repeating scenario_fit");
  });

  it("builds ordered agent step rows from stages, tool calls, and reflection tasks", () => {
    const rows = buildAgentStepRows({
      runId: "topic-run-1",
      agentRunId: "agent-run-1",
      articleId: "article-1",
      campaignId: "campaign-1",
      organizationId: "org-1",
      storeId: "store-1",
      locale: "en-US",
      agentRun: {
        stages: [
          {
            id: "stage-research",
            stage: "research",
            agentRole: "researcher",
            status: "passed",
            input: { topic: "Phone Case" },
            output: { evidenceCount: 2 },
            evidence: [{ type: "seed_keyword", source: "manual", label: "seed", value: "phone case", confidence: 80 }],
            warnings: [],
            decision: "Collected evidence.",
            startedAt: "2026-05-22T10:00:00.000Z",
            finishedAt: "2026-05-22T10:00:05.000Z",
            agentVersion: "test-agent"
          }
        ],
        toolCalls: [
          {
            id: "tool-trends",
            stage: "research",
            agentRole: "researcher",
            toolName: "trend_discovery",
            purpose: "Find timely angles.",
            status: "warning",
            input: { query: "phone case" },
            output: { trendCount: 0 },
            evidence: [],
            evidenceIds: ["evidence-1"],
            warnings: ["No trend found."],
            decisionSummary: "trend_discovery completed with 1 warning.",
            startedAt: "2026-05-22T10:00:02.000Z",
            finishedAt: "2026-05-22T10:00:03.000Z",
            latencyMs: 1000
          }
        ],
        reflectionTasks: [
          {
            priority: "P0",
            agentRole: "seo_editor",
            instruction: "Add stronger internal links.",
            acceptanceCheck: "Internal links are visible.",
            evidenceIds: ["evidence-1"],
            status: "open"
          }
        ],
        finishedAt: "2026-05-22T10:01:00.000Z"
      } as any
    });

    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.stepType)).toEqual(["stage", "tool_call", "reflection_task"]);
    expect(rows[0]).toMatchObject({ title: "research · researcher", status: "passed" });
    expect(rows[1]).toMatchObject({
      title: "工具调用 · trend_discovery",
      status: "warning",
      evidenceIds: ["evidence-1"],
      dependsOnStepKey: "stage-research",
      idempotencyKey: "agent-run-1:tool-trends",
      maxAttempts: 3,
      canResume: true
    });
    expect(rows[2]).toMatchObject({
      status: "failed",
      warnings: ["Add stronger internal links."],
      dependsOnStepKey: "tool-trends",
      maxAttempts: 2
    });
  });

  it("maps existing article keywords into cannibalization risks", () => {
    const signals = buildKeywordCannibalizationSignals({
      targetKeywords: ["clear phone case", "clear magsafe case"],
      currentArticleId: "current",
      articles: [
        {
          id: "existing-1",
          title: "Clear Phone Case Buyer Guide",
          status: "published",
          primaryKeyword: "clear phone case",
          secondaryKeywords: ["transparent iphone case"],
          canonicalUrl: "https://www.caseease.com/blogs/news/clear-phone-case-guide"
        },
        {
          id: "current",
          title: "Current Draft",
          status: "draft",
          primaryKeyword: "clear phone case",
          secondaryKeywords: [],
          canonicalUrl: null
        },
        {
          id: "unrelated",
          title: "Basketball Phone Case Gifts",
          status: "published",
          primaryKeyword: "basketball phone case",
          secondaryKeywords: [],
          canonicalUrl: null
        }
      ]
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      articleId: "existing-1",
      keyword: "clear phone case",
      risk: "high",
      source: "primary_keyword"
    });
  });

  it("clamps memory windows to a safe operating range", () => {
    expect(clampMemoryWindowDays(undefined)).toBe(180);
    expect(clampMemoryWindowDays(1)).toBe(7);
    expect(clampMemoryWindowDays(999)).toBe(730);
  });
});

function memoryRow(overrides: Partial<ReturnType<typeof baseMemoryRow>>) {
  return {
    ...baseMemoryRow(),
    ...overrides
  };
}

function baseMemoryRow() {
  return {
    id: "memory",
    keyword: "clear phone case",
    topicFingerprint: "clear phone case for desk setups",
    angleKey: "scenario_fit",
    outcome: "failed" as const,
    confidence: 80,
    qualityScore: 70,
    trafficScore: 72,
    learnedRule: "Avoid stale desk setup framing.",
    avoidUntil: null,
    lastUsedAt: new Date("2026-05-20T00:00:00.000Z"),
    createdAt: new Date("2026-05-19T00:00:00.000Z")
  };
}
