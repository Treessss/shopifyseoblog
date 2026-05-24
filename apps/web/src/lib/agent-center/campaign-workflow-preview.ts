import type { PythonWorkflowPlanRequest } from "@/lib/agent-center/python-agent-client";

type CampaignWorkflowPreviewInput = {
  organizationId: string;
  storeId: string;
  locale: string;
  topic?: string | null;
  primaryKeyword?: string | null;
  sourceId?: string | null;
  targetWordCount?: number;
  availableInternalLinks: number;
  availableExternalReferences: number;
  recentTopicCount: number;
  searchConsoleConnected: boolean;
  publishPolicy?: PythonWorkflowPlanRequest["publish_policy"];
  existingArticleId?: string | null;
  repairReason?: string | null;
};

type CampaignWorkflowStep = {
  key: string;
  title: string;
  agent_role: string;
  status: "pending" | "ready" | "blocked";
  objective: string;
  required_inputs: string[];
  outputs: string[];
  quality_gate?: string | null;
};

export interface CampaignWorkflowPlan {
  mode: string;
  topic: string;
  primary_keyword: string;
  workflow: CampaignWorkflowStep[];
  minimum_publish_score: number;
  minimum_expert_panel_score: number;
  publish_policy: string;
  blockers: string[];
  next_step: string;
}

export function buildCampaignWorkflowRequest(input: CampaignWorkflowPreviewInput): PythonWorkflowPlanRequest {
  return {
    organization_id: input.organizationId,
    store_id: input.storeId,
    locale: input.locale,
    source_type: "manual_topic",
    source_id: input.sourceId ?? null,
    topic: normalizeText(input.topic),
    primary_keyword: normalizeText(input.primaryKeyword),
    publish_policy: input.publishPolicy ?? "manual_review",
    target_word_count: input.targetWordCount ?? 1400,
    existing_article_id: input.existingArticleId ?? null,
    repair_reason: input.repairReason ?? null,
    available_internal_links: Math.max(0, input.availableInternalLinks),
    available_external_references: Math.max(0, input.availableExternalReferences),
    recent_topic_count: Math.max(0, input.recentTopicCount),
    search_console_connected: input.searchConsoleConnected
  };
}

export function buildCampaignWorkflowPlanFallback(request: PythonWorkflowPlanRequest): CampaignWorkflowPlan {
  const topic = request.topic?.trim() || request.primary_keyword?.trim() || "Shopify SEO content opportunity";
  const primaryKeyword = request.primary_keyword?.trim() || topic;
  const blockers = collectWorkflowBlockers(request);
  const researchStatus = hasAny(blockers, ["topic"]) ? "blocked" : "ready";
  const keywordStatus = hasAny(blockers, ["topic", "recent_topics"]) ? "blocked" : "ready";
  const draftStatus = hasAny(blockers, ["topic", "internal_links", "external_references"]) ? "blocked" : "ready";
  const expertPanelStatus =
    draftStatus !== "blocked" && keywordStatus === "ready" ? "ready" : "pending";
  const publishGuardStatus = expertPanelStatus === "ready" ? "ready" : "pending";
  const performanceReviewStatus =
    request.search_console_connected && publishGuardStatus === "ready"
      ? "ready"
      : !request.search_console_connected
        ? "blocked"
        : "pending";

  const workflow: CampaignWorkflowStep[] = [
    {
      key: "research",
      title: "Research and evidence collection",
      agent_role: "researcher",
      status: researchStatus,
      objective: "Collect Shopify facts, trend signals, internal links, and approved external references.",
      required_inputs: ["store_id", "source_type", "topic or primary_keyword"],
      outputs: ["research_brief", "keyword_evidence", "citation_candidates"],
      quality_gate: "No unsupported claims; separate verified facts from unknowns."
    },
    {
      key: "keyword_strategy",
      title: "Keyword and intent strategy",
      agent_role: "keyword_planner",
      status: keywordStatus,
      objective: "Map primary keyword, secondary keywords, long tails, and search intent.",
      required_inputs: ["research_brief", "recent_topics"],
      outputs: ["keyword_plan", "cannibalization_warnings"],
      quality_gate: "Primary keyword must fit one clear search intent."
    },
    {
      key: "draft",
      title: "Human-like article draft",
      agent_role: "writer",
      status: draftStatus,
      objective: "Draft a buyer-useful article with answer-first intro, sections, FAQ, and decision support.",
      required_inputs: ["keyword_plan", "research_brief", "brand_voice"],
      outputs: ["article_html", "seo_title", "meta_description"],
      quality_gate: "Avoid generic AI patterns, unsupported superlatives, and thin examples."
    },
    {
      key: "expert_panel",
      title: "Expert panel review",
      agent_role: "seo_editor",
      status: expertPanelStatus,
      objective: "Score the draft through SEO, humanizer, brand, and shopper-usefulness lenses.",
      required_inputs: ["article_html", "quality_report"],
      outputs: ["expert_panel_score", "revision_brief"],
      quality_gate: "Panel average must reach 90+ before publish."
    },
    {
      key: "publish_guard",
      title: "Publish guard",
      agent_role: "publisher_guard",
      status: publishGuardStatus,
      objective: "Allow publishing only when quality, SEO, links, citations, and Shopify requirements pass.",
      required_inputs: ["quality_gate", "shopify_blog_target"],
      outputs: ["publish_decision", "next_action"],
      quality_gate: "SEO score must reach 82+ and required checks must pass."
    },
    {
      key: "performance_review",
      title: "Search Console performance loop",
      agent_role: "growth_analyst",
      status: performanceReviewStatus,
      objective: "Use impressions, average position, CTR, and query gaps to create repair or new-campaign actions.",
      required_inputs: ["canonical_url", "search_console_property"],
      outputs: ["quick_wins", "refresh_tasks", "memory_updates"],
      quality_gate: "Do not claim ranking improvement without post-publish performance evidence."
    }
  ];

  return {
    mode: request.existing_article_id ? "article_repair" : "new_article",
    topic,
    primary_keyword: primaryKeyword,
    workflow,
    minimum_publish_score: 82,
    minimum_expert_panel_score: 90,
    publish_policy: request.publish_policy ?? "manual_review",
    blockers,
    next_step: resolveNextStep(blockers, workflow)
  };
}

export function buildCampaignStartSteps(plan: CampaignWorkflowPlan) {
  return plan.workflow.map((step, index) => ({
    index: String(index + 1),
    title: step.title,
    detail: `${formatWorkflowAgentRole(step.agent_role)} · ${workflowStepLabel(step.status)}`
  }));
}

export function workflowStepLabel(status: CampaignWorkflowStep["status"]) {
  switch (status) {
    case "ready":
      return "可执行";
    case "blocked":
      return "阻塞中";
    default:
      return "待执行";
  }
}

export function workflowStepTone(status: CampaignWorkflowStep["status"]): "good" | "warn" | "danger" | "neutral" {
  if (status === "ready") return "good";
  if (status === "blocked") return "danger";
  return "neutral";
}

export function formatWorkflowAgentRole(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function collectWorkflowBlockers(request: PythonWorkflowPlanRequest) {
  const blockers: string[] = [];
  if (!(request.topic?.trim() || request.primary_keyword?.trim())) blockers.push("topic");
  if ((request.available_internal_links ?? 0) <= 0) blockers.push("internal_links");
  if ((request.available_external_references ?? 0) <= 0) blockers.push("external_references");
  if ((request.recent_topic_count ?? 0) <= 0) blockers.push("recent_topics");
  if (!request.search_console_connected) blockers.push("search_console");
  return blockers;
}

function resolveNextStep(blockers: string[], workflow: CampaignWorkflowStep[]) {
  if (blockers.includes("topic")) return "先选主题或主关键词，再让 agent 进入研究和写作。";
  if (blockers.includes("internal_links")) return "先同步 Shopify 商品、集合与文章，让内链可以规划。";
  if (blockers.includes("external_references")) return "先补充批准的外部引用，再进入发布前预检。";
  if (blockers.includes("recent_topics")) return "先让系统积累足够近期主题，再开始分发。";
  if (blockers.includes("search_console")) return "先连接 Search Console，发布后才能做真实复盘。";

  const blockedStep = workflow.find((step) => step.status === "blocked");
  return blockedStep ? `先解除 ${blockedStep.title} 的阻塞。` : "预检通过，可以创建任务并进入队列。";
}

function hasAny(values: string[], candidates: string[]) {
  return candidates.some((candidate) => values.includes(candidate));
}

function normalizeText(value?: string | null) {
  return value?.trim() || null;
}
