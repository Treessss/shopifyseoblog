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
      ["research.evidence"]
    ),
    toolPlan(
      "research",
      "researcher",
      "external_citation_planner",
      "Select approved external references from trend evidence and demand sources so every article cites real sources.",
      true,
      ["trendSignals", "keywordStrategy", "generationConfig.externalReferences"]
    ),
    toolPlan(
      "topic_selection",
      "topic_strategist",
      "topic_opportunity_ranker",
      "Rank topic candidates by impact, confidence, novelty, commerce fit, and memory risk.",
      true,
      ["keywordStrategy", "agentMemories", "recentTopics"]
    ),
    toolPlan(
      "content_brief",
      "writer",
      "content_brief_builder",
      "Create an evidence-backed article brief with required modules, links, image references, and claims policy.",
      true,
      ["topicSelection", "skillDoctrine"]
    ),
    toolPlan(
      "draft_generation",
      "writer",
      "article_generator",
      "Generate Shopify-compatible HTML from the brief while avoiding reusable guide templates.",
      true,
      ["contentBrief", "skillDoctrine"]
    ),
    toolPlan(
      "quality_reflection",
      "seo_editor",
      "expert_panel_reflection",
      "Score the draft against SEO, information gain, evidence, structure, internal links, and editorial rhythm.",
      true,
      ["article", "qualityGate", "skillDoctrine"]
    )
  );

  if (context.generationConfig?.imageGeneration?.enabled !== false) {
    plans.push(
      toolPlan(
        "draft_generation",
        "writer",
        "image_prompt_director",
        "Create a product-image-grounded scene prompt for generated blog imagery.",
        false,
        ["imageReferences", "contentBrief"]
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
  inputRefs: string[]
): AgentToolPlan {
  return {
    id: `plan-${hashStable(`${stage}:${agentRole}:${toolName}:${purpose}`).toString(36)}`,
    stage,
    agentRole,
    toolName,
    purpose,
    required,
    inputRefs,
    expectedOutput: `${toolName} evidence or decision artifact`
  };
}

function hashStable(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
