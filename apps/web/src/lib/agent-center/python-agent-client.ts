const DEFAULT_PYTHON_AGENT_BASE_URL = "http://localhost:8000";

export interface PythonWorkflowPlanRequest {
  organization_id: string;
  store_id: string;
  locale?: string;
  source_type?: "product" | "collection" | "manual_topic";
  source_id?: string | null;
  topic?: string | null;
  primary_keyword?: string | null;
  publish_policy?: "auto_when_qualified" | "manual_review" | "direct";
  target_word_count?: number;
  existing_article_id?: string | null;
  repair_reason?: string | null;
  available_internal_links?: number;
  available_external_references?: number;
  recent_topic_count?: number;
  search_console_connected?: boolean;
}

export interface PythonAgentDescriptor {
  role: string;
  name: string;
  status: string;
  responsibility: string;
  sequence_index: number;
  queue_position: number;
  is_active: boolean;
  display_state?: string | null;
  current_step?: string | null;
  next_step?: string | null;
  state_reason?: string | null;
  evidence_count: number;
  open_tasks: number;
  stage?: string | null;
  objective?: string | null;
  outputs: string[];
  quality_gate?: string | null;
  blockers: string[];
  doctrine_sources: string[];
}

export interface PythonAgentCenterSnapshot {
  workflow: string[];
  agents: PythonAgentDescriptor[];
  next_action: string;
  warnings: string[];
  active_stage?: string | null;
  active_agent_role?: string | null;
  active_agent_name?: string | null;
  orchestration_mode: string;
  evidence_total: number;
  open_tasks_total: number;
  queued_agents_total: number;
  running_agents_total: number;
  blocked_agents_total: number;
  completed_agents_total: number;
  workflow_completion: number;
  doctrine_sources: string[];
}

export interface PythonIntegrationStatus {
  key: string;
  label: string;
  owner: string;
  status: string;
  summary: string;
  required_environment: string[];
  capabilities: string[];
  next_step: string;
}

export interface PythonIntegrationHealthSummary {
  status: string;
  ready_count: number;
  degraded_count: number;
  blocked_count: number;
  integrations: PythonIntegrationStatus[];
}

export interface PythonWorkflowPlan {
  mode: string;
  topic: string;
  primary_keyword: string;
  workflow: Array<{
    key: string;
    title: string;
    agent_role: string;
    status: "pending" | "ready" | "blocked";
    objective: string;
    required_inputs: string[];
    outputs: string[];
    quality_gate?: string | null;
  }>;
  minimum_publish_score: number;
  minimum_expert_panel_score: number;
  publish_policy: string;
  blockers: string[];
  next_step: string;
}

export interface PythonQualityGateRequest {
  title: string;
  body_html: string;
  summary?: string | null;
  primary_keyword?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_score?: number | null;
  ai_search_score?: number | null;
  editorial_score?: number | null;
  expert_panel_score?: number | null;
  has_canonical_url?: boolean;
  has_internal_links?: boolean;
  has_external_references?: boolean;
  has_faq?: boolean;
  has_decision_support?: boolean;
  has_images?: boolean;
  image_alt_texts?: string[];
  quality_passed?: boolean;
  brand_voice_banned_words?: string[];
}

export interface PythonQualityGateCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface PythonQualityGate {
  publish_ready: boolean;
  index_ready: boolean;
  score: number;
  checks: PythonQualityGateCheck[];
  next_step: string;
  humanizer_score: number;
  humanizer_signals: string[];
  humanizer_recommendations: string[];
  helpful_content_score: number;
  helpful_content_signals: string[];
  helpful_content_recommendations: string[];
  doctrine_sources: string[];
}

export interface PythonRepairPlanTask {
  id: string;
  agent_role: string;
  priority: "critical" | "high" | "medium" | "low";
  issue: string;
  instruction: string;
  acceptance_check: string;
  source_check_key?: string | null;
  depends_on: string[];
  outputs: string[];
}

export interface PythonRepairPlan {
  article_id?: string | null;
  canonical_url?: string | null;
  status?: string | null;
  repair_reason?: string | null;
  mode: "pre_publish_repair" | "publish_and_index" | "post_publish_refresh";
  summary: string;
  next_step: string;
  blockers: string[];
  quality_gate: PythonQualityGate;
  tasks: PythonRepairPlanTask[];
}

export interface PythonContentReadinessStage {
  key: string;
  label: string;
  badge: string;
  tone: "critical" | "high" | "medium" | "low";
  summary: string;
  required_checks: string[];
  agent_roles: string[];
  evidence_required: string[];
  next_action: string;
}

export interface PythonContentReadinessDoctrine {
  stages: PythonContentReadinessStage[];
  default_sequence: string[];
  no_guarantee_notice: string;
  doctrine_sources: string[];
}

export interface PythonContentArticleBlueprintSection {
  key: string;
  title: string;
  agent_role: string;
  purpose: string;
  target_words: number;
  must_have: string[];
  avoid: string[];
  quality_gate?: string | null;
}

export interface PythonContentArticleBlueprint {
  article_type: string;
  summary: string;
  audience: string;
  target_length: string;
  outline: PythonContentArticleBlueprintSection[];
  seo_rules: string[];
  humanizer_rules: string[];
  publish_rules: string[];
  anti_patterns: string[];
  doctrine_sources: string[];
}

export interface PythonContentArticleBriefSection {
  key: string;
  heading: string;
  agent_role: string;
  purpose: string;
  target_words: number;
  must_have: string[];
  avoid: string[];
}

export interface PythonContentArticleBrief {
  mode: string;
  topic: string;
  primary_keyword: string;
  audience: string;
  search_intent: string;
  summary: string;
  opening_angle: string;
  title_options: string[];
  meta_title_options: string[];
  meta_description_options: string[];
  h1: string;
  sections: PythonContentArticleBriefSection[];
  faq_questions: string[];
  internal_link_plan: string[];
  external_reference_plan: string[];
  humanizer_notes: string[];
  seo_rules: string[];
  publish_rules: string[];
  blockers: string[];
  next_step: string;
  doctrine_sources: string[];
}

export interface PythonSeoBoardRecommendation {
  title: string;
  reason: string;
  action: string;
  priority: "critical" | "high" | "medium" | "low";
  score: number;
  source: string;
}

export interface PythonSeoBoard {
  quick_wins: unknown[];
  competitor_gaps: unknown[];
  performance_matrix: unknown[];
  recommendations: PythonSeoBoardRecommendation[];
  quality_score: number;
  summary: string;
}

export function pythonAgentServiceEnabled() {
  return process.env.PYTHON_AGENT_SERVICE_ENABLED === "true";
}

export async function getPythonAgentSnapshot(): Promise<PythonAgentCenterSnapshot | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonAgentCenterSnapshot>("/api/v1/agents");
}

export async function getPythonIntegrationHealth(): Promise<PythonIntegrationHealthSummary | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonIntegrationHealthSummary>("/api/v1/health/integrations");
}

export async function createPythonAgentSnapshot(
  request: PythonWorkflowPlanRequest
): Promise<PythonAgentCenterSnapshot | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonAgentCenterSnapshot>("/api/v1/agents/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function createPythonWorkflowPlan(
  request: PythonWorkflowPlanRequest
): Promise<PythonWorkflowPlan | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonWorkflowPlan>("/api/v1/content/workflow-plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function createPythonQualityGate(
  request: PythonQualityGateRequest
): Promise<PythonQualityGate | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonQualityGate>("/api/v1/content/quality-gate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
}

export interface PythonRepairPlanRequest extends PythonQualityGateRequest {
  article_id?: string | null;
  canonical_url?: string | null;
  status?: string | null;
  repair_reason?: string | null;
}

export async function createPythonRepairPlan(
  request: PythonRepairPlanRequest
): Promise<PythonRepairPlan | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonRepairPlan>("/api/v1/content/repair-plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function getPythonContentReadinessDoctrine(): Promise<PythonContentReadinessDoctrine | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonContentReadinessDoctrine>("/api/v1/content/readiness-doctrine");
}

export async function getPythonContentArticleBlueprint(): Promise<PythonContentArticleBlueprint | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonContentArticleBlueprint>("/api/v1/content/article-blueprint");
}

export async function getPythonContentArticleBrief(
  request: PythonWorkflowPlanRequest
): Promise<PythonContentArticleBrief | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonContentArticleBrief>("/api/v1/content/article-brief", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function getPythonSeoBoard(): Promise<PythonSeoBoard | null> {
  if (!pythonAgentServiceEnabled()) return null;
  return pythonAgentFetch<PythonSeoBoard>("/api/v1/seo/board");
}

async function pythonAgentFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const baseUrl = (process.env.PYTHON_AGENT_SERVICE_URL ?? DEFAULT_PYTHON_AGENT_BASE_URL).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {})
    }
  }).catch(() => null);

  if (!response?.ok) return null;
  return (await response.json()) as T;
}
