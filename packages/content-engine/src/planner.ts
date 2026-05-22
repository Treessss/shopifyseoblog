import type {
  AgentRole,
  AgentStageName,
  AgentToolPlan,
  ContentSourceContext,
  NormalizedContentPipelineInput
} from "./types";

export function planAgentTools(
  input: NormalizedContentPipelineInput,
  context: ContentSourceContext
): AgentToolPlan[] {
  const plans: AgentToolPlan[] = [];

  plans.push(
    toolPlan("research", "researcher", "shopify_context", "Load Shopify product or collection facts as the factual source of truth.", true, [
      "sourceType",
      "sourceId"
    ])
  );

  if (input.generationConfig?.hotNews?.enabled || input.generationConfig?.topicDiscovery?.preferTrendSignals) {
    plans.push(
      toolPlan(
        "research",
        "researcher",
        "trend_discovery",
        "Search Google News and Google Trends RSS for timely angles that fit the product/category.",
        false,
        ["topic", "seedKeywords", "catalogContext"]
      )
    );
  }

  plans.push(
    toolPlan(
      "keyword_strategy",
      "keyword_planner",
      "keyword_evidence_builder",
      "Build keyword clusters from seed terms, catalog facts, trend signals, and available internal links.",
      true,
      ["research.evidence"],
      ["product", "collection", "seed_keyword", "trend", "internal_link"],
      ["Primary keyword has evidence", "Cluster covers primary demand and long-tail buyer questions"]
    ),
    ...(context.keywordCannibalization?.length
      ? [
          toolPlan(
            "keyword_strategy",
            "keyword_planner",
            "keyword_cannibalization_check",
            "Compare the planned keyword cluster with existing articles so the new draft does not compete against the store's own URLs.",
            true,
            ["keywordStrategy.clusters", "existingArticles", "recentTopics"],
            [],
            ["High-overlap existing articles are identified", "Risky keywords are blocked or reframed before drafting"]
          )
        ]
      : []),
    toolPlan(
      "research",
      "researcher",
      "external_citation_planner",
      "Select approved external references from trend evidence and demand sources so every article cites real sources.",
      true,
      ["trendSignals", "keywordStrategy", "generationConfig.externalReferences"],
      ["external_reference", "trend"],
      ["Only approved real URLs are used", "At least the configured minimum citation count is available when enabled"]
    ),
    toolPlan(
      "topic_selection",
      "topic_strategist",
      "topic_opportunity_ranker",
      "Rank topic candidates by impact, confidence, novelty, commerce fit, and memory risk.",
      true,
      ["keywordStrategy", "agentMemories", "recentTopics"],
      ["product", "collection", "seed_keyword", "trend", "internal_link"],
      ["Opportunity score meets configured floor", "Selected angle is not a stale repetition"]
    ),
    toolPlan(
      "topic_selection",
      "topic_strategist",
      "memory_strategy",
      "Convert long-term agent memory into concrete topic, brief, and revision constraints.",
      true,
      ["agentMemories", "recentTopics", "topicSelection.selected"],
      [],
      ["Active avoid windows are respected", "Failed keyword patterns are transformed into actionable differentiation rules"]
    ),
    toolPlan(
      "content_brief",
      "writer",
      "content_brief_builder",
      "Create an evidence-backed article brief with required modules, links, image references, and claims policy.",
      true,
      ["topicSelection", "skillDoctrine", "memoryStrategy"],
      ["product", "collection", "trend", "internal_link", "external_reference"],
      ["Brief includes evidence, citations, internal links, image direction, and memory guidance"]
    ),
    toolPlan(
      "draft_generation",
      "writer",
      "article_generator",
      "Generate Shopify-compatible HTML from the brief while avoiding reusable guide templates.",
      true,
      ["contentBrief", "skillDoctrine"],
      ["product", "collection", "trend", "internal_link", "external_reference"],
      ["Article follows the brief", "Article avoids exposed SEO/prompt language and repeated template phrasing"]
    ),
    toolPlan(
      "quality_reflection",
      "seo_editor",
      "expert_panel_reflection",
      "Score the draft against SEO, information gain, evidence, structure, internal links, and editorial rhythm.",
      true,
      ["article", "qualityGate", "skillDoctrine", "memoryStrategy"],
      ["product", "collection", "trend", "internal_link", "external_reference"],
      ["Revision tasks are specific", "Memory guidance and evidence compliance are checked before publish"]
    )
  );

  if (input.generationConfig?.imageGeneration?.enabled !== false) {
    plans.push(
      toolPlan(
        "draft_generation",
        "writer",
        "image_prompt_director",
        "Create a product-image-grounded scene prompt for generated blog imagery.",
        false,
        ["imageReferences", "contentBrief"],
        ["product", "collection"],
        ["Prompt uses available product image references", "Prompt names scene, composition, lighting, and exclusions"]
      )
    );
  }

  return plans;
}

function toolPlan(
  stage: AgentStageName,
  agentRole: AgentRole,
  toolName: string,
  purpose: string,
  required: boolean,
  inputRefs: string[],
  requiredEvidenceTypes: AgentToolPlan["requiredEvidenceTypes"] = [],
  decisionCriteria: string[] = []
): AgentToolPlan {
  return {
    id: `plan-${hashStable(`${stage}:${agentRole}:${toolName}:${purpose}`).toString(36)}`,
    stage,
    agentRole,
    toolName,
    purpose,
    required,
    inputRefs,
    expectedOutput: `${toolName} evidence or decision artifact`,
    requiredEvidenceTypes,
    decisionCriteria
  };
}

function hashStable(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
