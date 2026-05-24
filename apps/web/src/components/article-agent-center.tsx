import Link from "next/link";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  FileSearch,
  Flame,
  Gauge,
  ListTodo,
  MessageSquareText,
  Radar,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Workflow
} from "lucide-react";
import type { AdminArticleReviewView } from "@/lib/admin-client";
import { formatArticleStatus, formatPriorityKind } from "@/lib/admin-client";
import { Badge, EmptyState, Panel, StatusPill } from "@/components/ui";

export interface ArticleAgentCenterProps {
  article: AdminArticleReviewView;
  qualityReport: unknown;
  aiSearchScore: number | null;
  aiSearchReview: Record<string, unknown>;
  aiSearchInitial: Record<string, unknown>;
  aiSearchFinal: Record<string, unknown>;
  aiSearchRevisions: Array<Record<string, unknown>>;
  aiSearchActionItems: Array<Record<string, unknown>>;
  seoAgent: Record<string, unknown>;
  agentStages: Array<Record<string, unknown>>;
  agentToolCalls: Array<Record<string, unknown>>;
  agentReflectionTasks: Array<Record<string, unknown>>;
  agentMemory: Record<string, unknown>;
  structuredAgentTrace: Record<string, unknown>;
  agentSteps: Array<Record<string, unknown>>;
  visibleAgentToolCalls: Array<Record<string, unknown>>;
  visibleReflectionTasks: Array<Record<string, unknown>>;
  executionStepCount: number;
  evidenceSummary: {
    topicSelection?: unknown;
    keywordEvidence?: unknown;
    trendSignals?: unknown;
    entityInsights?: unknown;
    externalReferences?: unknown;
    marketInsights?: unknown;
    competitorAngles?: unknown;
    sourceSummary?: unknown;
    contentBrief?: unknown;
  } | null;
  compact?: boolean;
}

export function ArticleAgentCenter({
  article,
  qualityReport,
  aiSearchScore,
  aiSearchReview,
  aiSearchInitial,
  aiSearchFinal,
  aiSearchRevisions,
  aiSearchActionItems,
  seoAgent,
  agentStages,
  agentToolCalls,
  agentReflectionTasks,
  agentMemory,
  structuredAgentTrace,
  agentSteps,
  visibleAgentToolCalls,
  visibleReflectionTasks,
  executionStepCount,
  evidenceSummary,
  compact = false
}: ArticleAgentCenterProps) {
  const topicSelection = asRecord(evidenceSummary?.topicSelection);
  const selectedTopic = asRecord(topicSelection.selected);
  const selectedAgent = asRecord(selectedTopic.agent);
  const keywordEvidence = normalizeEvidenceItems(evidenceSummary?.keywordEvidence);
  const trendSignals = normalizeTrendSignals(evidenceSummary?.trendSignals);
  const entityInsights = normalizeEntityInsights(evidenceSummary?.entityInsights);
  const externalReferences = normalizeExternalReferences(evidenceSummary?.externalReferences);
  const marketInsights = normalizeMarketInsights(evidenceSummary?.marketInsights);
  const competitorAngles = normalizeCompetitorAngles(evidenceSummary?.competitorAngles);
  const sourceSummary = asRecord(evidenceSummary?.sourceSummary);
  const contentBrief = asRecord(evidenceSummary?.contentBrief);
  const claimsPolicy = stringArray(contentBrief.claimsPolicy);
  const learnedRules = stringArray(agentMemory.learnedRules);
  const blockedAngles = stringArray(agentMemory.blockedAngles);
  const recommendations = stringArray(agentMemory.recommendations);
  const runVersion = stringValue(structuredAgentTrace.agentVersion) ?? stringValue(seoAgent.agentVersion) ?? "未记录";
  const runStatus = stringValue(structuredAgentTrace.status) ?? stringValue(seoAgent.status) ?? "未记录";
  const stepCount = numberValue(structuredAgentTrace.stepCount) ?? executionStepCount;
  const toolCallCount = numberValue(structuredAgentTrace.toolCallCount) ?? visibleAgentToolCalls.length;
  const reflectionCount = numberValue(structuredAgentTrace.reflectionTaskCount) ?? visibleReflectionTasks.length;
  const initialScore = numberValue(aiSearchInitial.score);
  const finalScore = numberValue(aiSearchFinal.score);
  const minTrafficScore = numberValue(aiSearchReview.minTrafficScore) ?? 82;
  const revisionCount = aiSearchRevisions.length;
  const candidateCount = arrayLength(topicSelection.candidates);

  return (
    <div className="stack">
      <Panel
        title="AI Agent 指挥台"
        description="把文章的选题、搜索评审、记忆规则和运行轨迹收拢成一块可直接操作的控制台。"
        action={
          <div className="toolbar">
            <Link href="/research" className="button button--ghost">
              <Radar size={16} aria-hidden="true" />
              研究台
            </Link>
            <Link href="/performance-review" className="button button--ghost">
              <TrendingUp size={16} aria-hidden="true" />
              性能复盘
            </Link>
            <Link href="/priorities" className="button button--ghost">
              <ListTodo size={16} aria-hidden="true" />
              优先级板
            </Link>
          </div>
        }
      >
        <div className="insight-strip">
          <StatusPill
            label="文章状态"
            value={formatArticleStatus(article.status)}
            tone={toneForArticleStatus(article.status)}
            icon={<FileSearch size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="AI 搜索分"
            value={aiSearchScore ?? "暂无"}
            tone={toneForScore(aiSearchScore)}
            icon={<Gauge size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="Agent 步骤"
            value={stepCount}
            tone={stepCount > 0 ? "good" : "neutral"}
            icon={<Workflow size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="工具 / 反思"
            value={`${toolCallCount} / ${reflectionCount}`}
            tone={toolCallCount > 0 || reflectionCount > 0 ? "warn" : "neutral"}
            icon={<Bot size={18} aria-hidden="true" />}
          />
        </div>

        <div className={compact ? "grid grid--two" : "grid grid--two"}>
          <div className="list">
            <div className="list-item">
              <div>
                <strong>当前版本</strong>
                <small className="muted code">{runVersion}</small>
              </div>
              <Badge tone="neutral">{runStatus}</Badge>
            </div>
            <div className="list-item">
              <div>
                <strong>发布状态</strong>
                <small className="muted">准备发布、同步搜索表现和回看研究台的入口都在这里。</small>
              </div>
              <Badge tone={toneForArticleStatus(article.status)}>{formatArticleStatus(article.status)}</Badge>
            </div>
            <div className="list-item">
              <div>
                <strong>选题候选</strong>
                <small className="muted">
                  {stringValue(selectedTopic.topic) ?? article.title} · {candidateCount} 个候选
                </small>
              </div>
              <Badge tone={selectedAgent.angleKey ? "good" : "neutral"}>
                {stringValue(selectedAgent.angleKey) ?? "未记录"}
              </Badge>
            </div>
          </div>

          <div className="list">
            <div className="list-item">
              <div>
                <strong>快速动作</strong>
                <small className="muted">把当前文章直接带回研究和任务流。</small>
              </div>
              <form action={`/api/admin/articles/${article.id}/repair`} method="post">
                <input type="hidden" name="repairReason" value="从 AI Agent 指挥台触发：根据质检报告、搜索评分、关键词证据和 Agent 反思任务修复。" />
                <button className="button button--small" type="submit">
                  AI 修复
                  <Sparkles size={14} aria-hidden="true" />
                </button>
              </form>
            </div>
            {article.repairJob ? (
              <div className="list-item">
                <div>
                  <strong>最近修复任务</strong>
                  <small className="muted">{article.repairJob.message}</small>
                </div>
                <Badge tone={article.repairJob.statusTone}>{article.repairJob.status}</Badge>
              </div>
            ) : null}
            <div className="list-item">
              <div>
                <strong>搜索表现</strong>
                <small className="muted">同步后再回来看 page 2 和低 CTR 的变化。</small>
              </div>
              <Link href="/search-console" className="button button--small">
                打开
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <div className="list-item">
              <div>
                <strong>线上页面</strong>
                <small className="muted">检查发布后的 canonical 页面表现。</small>
              </div>
              {article.canonicalUrl ? (
                <a className="button button--small" href={article.canonicalUrl} target="_blank" rel="noreferrer">
                  查看
                  <ArrowRight size={14} aria-hidden="true" />
                </a>
              ) : (
                <span className="muted">未发布</span>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid--two">
        <Panel title="关键词与依据" description="选题、关键词和来源证据。" compact>
          {topicSelection && Object.keys(topicSelection).length > 0 ? (
            <dl className="detail-list">
              <div>
                <dt>主话题</dt>
                <dd>{stringValue(selectedTopic.topic) ?? article.title}</dd>
              </div>
              <div>
                <dt>主关键词</dt>
                <dd className="code">{stringValue(selectedTopic.primaryKeyword) ?? article.primaryKeyword ?? "未记录"}</dd>
              </div>
              <div>
                <dt>搜索意图</dt>
                <dd>{stringValue(selectedAgent.searchIntent) ?? "未记录"}</dd>
              </div>
              <div>
                <dt>漏斗阶段</dt>
                <dd>{stringValue(selectedAgent.funnelStage) ?? "未记录"}</dd>
              </div>
            </dl>
          ) : null}

          {keywordEvidence.length > 0 ? (
            <div className="list">
              {keywordEvidence.slice(0, compact ? 4 : 8).map((item) => (
                <div className="research-row" key={`${item.label}-${item.value}`}>
                  <div>
                    <strong>{item.label}</strong>
                    <small className="muted">
                      {item.value}
                      {item.source ? ` · ${item.source}` : ""}
                      {item.type ? ` · ${item.type}` : ""}
                    </small>
                    {item.snippet ? <small className="muted">{item.snippet}</small> : null}
                  </div>
                  <div className="row-actions">
                    {item.verified !== null ? <Badge tone={item.verified ? "good" : "warn"}>{item.verified ? "已验证" : "需核实"}</Badge> : null}
                    {item.metric ? <Badge tone="neutral">{item.metric}</Badge> : null}
                    {item.publishedAt ? <Badge tone="neutral">{item.publishedAt.slice(0, 10)}</Badge> : null}
                    {typeof item.confidence === "number" ? <Badge tone={item.confidence >= 80 ? "good" : item.confidence >= 60 ? "warn" : "neutral"}>{item.confidence}</Badge> : null}
                    {item.url ? (
                      <a className="button button--small" href={item.url} target="_blank" rel="noreferrer">
                        来源
                        <ArrowRight size={14} aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无关键词依据" description="生成完成后，选题证据和 Search Console 关联会显示在这里。" />
          )}
        </Panel>

        <Panel title="研究证据链" description="热点、IP/角色背景、外部来源和声明边界。" compact>
          <dl className="detail-list">
            <div>
              <dt>热点/新闻</dt>
              <dd>{numberValue(sourceSummary.trendCount) ?? trendSignals.length}</dd>
            </div>
            <div>
              <dt>IP/实体</dt>
              <dd>{numberValue(sourceSummary.entityInsightCount) ?? entityInsights.length}</dd>
            </div>
            <div>
              <dt>市场洞察</dt>
              <dd>{numberValue(sourceSummary.marketInsightCount) ?? marketInsights.length}</dd>
            </div>
            <div>
              <dt>竞品角度</dt>
              <dd>{numberValue(sourceSummary.competitorAngleCount) ?? competitorAngles.length}</dd>
            </div>
            <div>
              <dt>外部引用</dt>
              <dd>{numberValue(sourceSummary.externalReferenceCount) ?? externalReferences.length}</dd>
            </div>
            <div>
              <dt>证据总数</dt>
              <dd>{keywordEvidence.length}</dd>
            </div>
          </dl>

          <EvidenceRows title="最近热点/新闻" items={trendSignals.slice(0, compact ? 3 : 5)} emptyTitle="暂无热点信号" />
          <EvidenceRows title="IP/卡通人物洞察" items={entityInsights.slice(0, compact ? 3 : 5)} emptyTitle="暂无实体洞察" />
          <EvidenceRows title="市场洞察" items={marketInsights.slice(0, compact ? 3 : 5)} emptyTitle="暂无市场洞察" />
          <EvidenceRows title="竞品角度" items={competitorAngles.slice(0, compact ? 3 : 5)} emptyTitle="暂无竞品角度" />
          <EvidenceRows title="外部引用来源" items={externalReferences.slice(0, compact ? 3 : 5)} emptyTitle="暂无外部引用" />
          {claimsPolicy.length > 0 ? <TextList title="声明边界" items={claimsPolicy.slice(0, compact ? 3 : 6)} /> : null}
        </Panel>

        <Panel title="AI 搜索复盘" description="初评、终评、重写回合和待优化项。" compact>
          <dl className="detail-list">
            <div>
              <dt>初评分</dt>
              <dd>{initialScore ?? "暂无"}</dd>
            </div>
            <div>
              <dt>最终分</dt>
              <dd>{finalScore ?? "暂无"}</dd>
            </div>
            <div>
              <dt>最低阈值</dt>
              <dd>{minTrafficScore}</dd>
            </div>
            <div>
              <dt>改稿回合</dt>
              <dd>{revisionCount}</dd>
            </div>
          </dl>

          <ScoreGrid review={aiSearchFinal} />
          <TextList title="AI 判断" items={[stringValue(aiSearchFinal.summary)].filter(Boolean) as string[]} />
          <ActionItemList title="最终待优化点" items={aiSearchActionItems} />
          <RevisionList revisions={aiSearchRevisions} compact={compact} />
        </Panel>
      </div>

      <Panel title="质检报告" description="结构化质检、编辑和事实门禁结果。" compact>
        <JsonBlockLike value={qualityReport} />
      </Panel>

      <Panel title="Agent 轨迹" description="阶段、工具调用和反思任务的执行线。">
        <dl className="detail-list">
          <div>
            <dt>Agent 版本</dt>
            <dd className="code">{runVersion}</dd>
          </div>
          <div>
            <dt>执行状态</dt>
            <dd>{runStatus}</dd>
          </div>
          <div>
            <dt>工具调用</dt>
            <dd>{toolCallCount}</dd>
          </div>
          <div>
            <dt>反思任务</dt>
            <dd>{reflectionCount}</dd>
          </div>
        </dl>

        <div className="stack">
          {agentSteps.length > 0 ? (
            <AgentStepTimeline steps={agentSteps.slice(0, compact ? 4 : 8)} />
          ) : agentStages.length > 0 ? (
            <AgentTimeline stages={agentStages.slice(0, compact ? 4 : 8)} />
          ) : visibleAgentToolCalls.length > 0 ? (
            <AgentToolCallTimeline calls={visibleAgentToolCalls.slice(0, compact ? 4 : 8)} />
          ) : (
            <EmptyState title="暂无 Agent 轨迹" description="商业级 SEO Agent 运行后会展示阶段、工具、反思任务和记忆命中。" />
          )}

          {visibleReflectionTasks.length > 0 ? <ActionItemList title="Agent 反思任务" items={visibleReflectionTasks.slice(0, compact ? 4 : 8)} /> : null}

          {visibleAgentToolCalls.length > 0 ? <AgentToolCallTimeline calls={visibleAgentToolCalls.slice(0, compact ? 4 : 8)} /> : null}
          {agentToolCalls.length > 0 && visibleAgentToolCalls.length === 0 ? <AgentToolCallTimeline calls={agentToolCalls.slice(0, compact ? 4 : 8)} /> : null}
          {agentReflectionTasks.length > 0 && visibleReflectionTasks.length === 0 ? <ActionItemList title="原始反思任务" items={agentReflectionTasks.slice(0, compact ? 4 : 8)} /> : null}
        </div>
      </Panel>

      <div className="grid grid--two">
        <Panel title="记忆规则" description="长期约束、避让角度和可复用经验。" compact>
          <div className="stack">
            {learnedRules.length > 0 ? <TextList title="已学规则" items={learnedRules.slice(0, compact ? 4 : 8)} /> : <EmptyState title="暂无记忆规则" description="新的 agent 运行会把 learned rules 和避让角度写回这里。" />}
            {blockedAngles.length > 0 ? <TextList title="避让角度" items={blockedAngles.map((angle) => `避开角度：${angle}`).slice(0, compact ? 4 : 8)} /> : null}
            {recommendations.length > 0 ? <TextList title="记忆建议" items={recommendations.slice(0, compact ? 4 : 8)} /> : null}
            <JsonBlockLike value={agentMemory} />
          </div>
        </Panel>

        <Panel title="下一步" description="把当前文章重新接回任务流。" compact>
          <div className="list">
            <ActionLink href="/campaigns#new-campaign" title="新建内容任务" description="把选题直接变成 campaign。">
              新建
            </ActionLink>
            <form action={`/api/admin/articles/${article.id}/repair`} method="post">
              <input type="hidden" name="repairReason" value="从下一步面板触发：按 seomachine analyze-existing → rewrite → optimize → performance-review 闭环修复。" />
              <button className="list-item" type="submit" title="AI 修复文章">
                <div>
                  <strong>AI 修复文章</strong>
                  <small className="muted">按现有证据原地重写，不重新建任务。</small>
                </div>
                <span className="button button--small">
                  修复
                  <Sparkles size={14} aria-hidden="true" />
                </span>
              </button>
            </form>
            <ActionLink href="/research" title="打开研究台" description="回到研究桌面看相邻主题和快赢。">
              研究
            </ActionLink>
            <ActionLink href="/performance-review" title="性能复盘" description="检查下滑、低 CTR 和趋势。">
              复盘
            </ActionLink>
            <ActionLink href="/priorities" title="优先级板" description="把当前文章和 agent 记忆风险排进队列。">
              优先级
            </ActionLink>
            <ActionLink href="/search-console" title="Search Console" description="检查快照和查询行。">
              Search
            </ActionLink>
            {article.canonicalUrl ? (
              <ActionLink href={article.canonicalUrl} external title="线上文章" description="查看发布后的页面。">
                线上
              </ActionLink>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ActionLink(props: { href: string; title: string; description: string; children: string; external?: boolean }) {
  if (props.external) {
    return (
      <a className="list-item" href={props.href} target="_blank" rel="noreferrer" title={props.title}>
        <div>
          <strong>{props.title}</strong>
          <small className="muted">{props.description}</small>
        </div>
        <span className="button button--small">
          {props.children}
          <ArrowRight size={14} aria-hidden="true" />
        </span>
      </a>
    );
  }

  return (
    <Link className="list-item" href={props.href} title={props.title}>
      <div>
        <strong>{props.title}</strong>
        <small className="muted">{props.description}</small>
      </div>
      <span className="button button--small">
        {props.children}
        <ArrowRight size={14} aria-hidden="true" />
      </span>
    </Link>
  );
}

function ScoreGrid({ review }: { review: Record<string, unknown> }) {
  const scores = [
    ["搜索意图", review.searchIntentScore],
    ["标题点击", review.titleCtrScore],
    ["内容深度", review.contentDepthScore],
    ["关键词匹配", review.keywordFitScore],
    ["主题权威", review.topicalAuthorityScore],
    ["转化支持", review.conversionSupportScore]
  ]
    .map(([label, value]) => ({ label: String(label), value: numberValue(value) }))
    .filter((item) => item.value !== null);

  if (scores.length === 0) return null;

  return (
    <dl className="detail-list">
      {scores.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <strong>{title}</strong>
      <div className="json-block">
        {items.map((item, index) => (
          <div key={`${title}-${index}-${item}`}>{item}</div>
        ))}
      </div>
    </div>
  );
}

function EvidenceRows({ title, items, emptyTitle }: { title: string; items: EvidenceDisplayItem[]; emptyTitle: string }) {
  return (
    <div>
      <strong>{title}</strong>
      {items.length > 0 ? (
        <div className="list">
          {items.map((item, index) => (
            <div className="research-row" key={`${item.kind}-${item.title}-${index}`}>
              <div>
                <strong>{item.title}</strong>
                <small className="muted">
                  {item.source}
                  {item.detail ? ` · ${item.detail}` : ""}
                </small>
                {item.summary ? <small className="muted">{item.summary}</small> : null}
              </div>
              <div className="row-actions">
                {item.verified !== null ? <Badge tone={item.verified ? "good" : "warn"}>{item.verified ? "已验证" : "需核实"}</Badge> : null}
                {typeof item.confidence === "number" ? <Badge tone={item.confidence >= 80 ? "good" : item.confidence >= 60 ? "warn" : "neutral"}>{item.confidence}</Badge> : null}
                {item.url ? (
                  <a className="button button--small" href={item.url} target="_blank" rel="noreferrer">
                    来源
                    <ArrowRight size={14} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title={emptyTitle} description="Agent 运行后会在这里显示可追溯来源。" />
      )}
    </div>
  );
}

function AgentTimeline({ stages }: { stages: Array<Record<string, unknown>> }) {
  return (
    <div className="json-block">
      {stages.map((stage, index) => {
        const name = stringValue(stage.stage) ?? `stage-${index + 1}`;
        const role = stringValue(stage.agentRole) ?? "agent";
        const status = stringValue(stage.status) ?? "unknown";
        const decision = stringValue(stage.decision);

        return (
          <div key={`${name}-${index}`} className="stack">
            <strong>
              {index + 1}. {name} · {role} · {status}
            </strong>
            {decision ? <div>{decision}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function AgentStepTimeline({ steps }: { steps: Array<Record<string, unknown>> }) {
  return (
    <div className="json-block">
      {steps.map((step, index) => {
        const sequence = numberValue(step.sequence) ?? index + 1;
        const title = stringValue(step.title) ?? stringValue(step.key) ?? `step-${sequence}`;
        const status = stringValue(step.status) ?? "unknown";
        const type = stringValue(step.type) ?? "step";
        const summary = stringValue(step.summary) ?? stringValue(step.decision);
        const warnings = stringArray(step.warnings);
        const input = step.input;
        const output = step.output;

        return (
          <div key={`${sequence}-${title}`} className="stack">
            <strong>
              {sequence}. {title} · {type} · {status}
            </strong>
            {summary ? <div>{summary}</div> : null}
            {hasMeaningfulValue(input) ? <JsonMiniBlock title="输入" value={input} /> : null}
            {hasMeaningfulValue(output) ? <JsonMiniBlock title="输出" value={output} /> : null}
            {warnings.length > 0 ? <TextList title="警告" items={warnings.slice(0, 3)} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function AgentToolCallTimeline({ calls }: { calls: Array<Record<string, unknown>> }) {
  return (
    <div className="json-block">
      {calls.map((call, index) => {
        const toolName = stringValue(call.toolName) ?? stringValue(call.tool) ?? `tool-${index + 1}`;
        const status = stringValue(call.status) ?? "unknown";
        const stage = stringValue(call.stage) ?? "tool";
        const role = stringValue(call.agentRole);
        const warnings = stringArray(call.warnings);
        const purpose = stringValue(call.purpose);
        const decisionSummary = stringValue(call.decisionSummary);
        const evidenceIds = stringArray(call.evidenceIds);
        const input = call.input;
        const output = call.output;
        const error = stringValue(call.error);
        const metadata = call.metadata;

        return (
          <div key={`${toolName}-${index}`} className="stack">
            <strong>
              {index + 1}. 工具调用 · {toolName} · {stage} · {status}
            </strong>
            {role ? <div>负责 Agent：{role}</div> : null}
            {purpose ? <div>{purpose}</div> : null}
            {decisionSummary ? <div>{decisionSummary}</div> : null}
            {evidenceIds.length > 0 ? <div className="muted">证据：{evidenceIds.slice(0, 4).join(" · ")}</div> : null}
            {hasMeaningfulValue(input) ? <JsonMiniBlock title="输入" value={input} /> : null}
            {hasMeaningfulValue(output) ? <JsonMiniBlock title="输出" value={output} /> : null}
            {hasMeaningfulValue(metadata) ? <JsonMiniBlock title="元数据" value={metadata} /> : null}
            {error ? <div className="error-copy">错误：{error}</div> : null}
            {warnings.length > 0 ? <TextList title="警告" items={warnings.slice(0, 3)} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function ActionItemList({ title, items }: { title: string; items: Array<Record<string, unknown>> }) {
  if (items.length === 0) return null;

  return (
    <div>
      <strong>{title}</strong>
      <div className="json-block">
        {items.map((item, index) => {
          const priority = stringValue(item.priority) ?? "high";
          const area = stringValue(item.area) ?? stringValue(item.agentRole) ?? "文章";
          const issue = stringValue(item.issue) ?? stringValue(item.status) ?? "待处理";
          const concreteEdit = stringValue(item.concreteEdit) ?? stringValue(item.instruction) ?? "暂无具体改法";
          const acceptanceCheck = stringValue(item.acceptanceCheck) ?? "确认修改已经落地。";

          return (
            <div key={`${area}-${index}`} className="stack">
              <strong>
                {index + 1}. [{priority}] {area}
              </strong>
              <div>问题：{issue}</div>
              <div>改法：{concreteEdit}</div>
              <div>验收：{acceptanceCheck}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RevisionList({ revisions, compact }: { revisions: Array<Record<string, unknown>>; compact: boolean }) {
  if (revisions.length === 0) return null;

  return (
    <div>
      <strong>改稿回合</strong>
      <div className="json-block">
        {revisions.slice(0, compact ? 3 : 6).map((revision, index) => {
          const pass = numberValue(revision.pass) ?? index + 1;
          const beforeScore = numberValue(revision.beforeScore);
          const afterScore = numberValue(revision.afterScore);
          return (
            <div key={`${pass}-${index}`} className="stack">
              <strong>
                第 {pass} 次：{beforeScore ?? "-"} → {afterScore ?? "-"}
              </strong>
              <TextList title="修改依据" items={stringArray(revision.recommendations)} />
              <TextList title="改稿变化" items={stringArray(revision.changes)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JsonBlockLike({ value }: { value: unknown }) {
  if (!value || (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0)) {
    return <EmptyState title="暂无记忆快照" description="Agent 记忆与规则会在这里显示。" />;
  }

  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

function JsonMiniBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <strong>{title}</strong>
      <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function normalizeEvidenceItems(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          label: `证据 ${index + 1}`,
          value: item,
          source: "手工依据",
          confidence: null as number | null,
          metric: null as string | null,
          url: null as string | null
        };
      }

      const record = asRecord(item);
      return {
        label: stringValue(record.label) ?? stringValue(record.title) ?? `证据 ${index + 1}`,
        value: stringValue(record.value) ?? stringValue(record.snippet) ?? stringValue(record.query) ?? "未命名证据",
        source: stringValue(record.source) ?? "unknown",
        type: stringValue(record.type) ?? null,
        snippet: stringValue(record.snippet) ?? null,
        publishedAt: stringValue(record.publishedAt) ?? null,
        confidence: numberValue(record.confidence),
        metric: stringValue(record.metric),
        url: stringValue(record.url),
        verified: inferEvidenceVerified(record)
      };
    })
    .filter((item) => Boolean(item.label || item.value));
}

type EvidenceDisplayItem = {
  kind: string;
  title: string;
  source: string;
  detail: string | null;
  summary: string | null;
  url: string | null;
  confidence: number | null;
  verified: boolean | null;
};

type KeywordEvidenceDisplayItem = {
  label: string;
  value: string;
  source: string;
  type: string | null;
  snippet: string | null;
  publishedAt: string | null;
  confidence: number | null;
  metric: string | null;
  url: string | null;
  verified: boolean | null;
};

function normalizeTrendSignals(value: unknown): EvidenceDisplayItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = asRecord(item);
      return {
        kind: "trend",
        title: stringValue(record.title) ?? `热点 ${index + 1}`,
        source: stringValue(record.source) ?? "trend feed",
        detail: [stringValue(record.query), stringValue(record.traffic), stringValue(record.publishedAt)].filter(Boolean).join(" · ") || null,
        summary: stringValue(record.summary),
        url: stringValue(record.url),
        confidence: numberValue(record.relevanceScore),
        verified: stringValue(record.url) ? true : null
      };
    })
    .filter((item) => Boolean(item.title));
}

function normalizeEntityInsights(value: unknown): EvidenceDisplayItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = asRecord(item);
      const evidence = stringArray(record.evidence).slice(0, 2).join(" · ");
      return {
        kind: "entity",
        title: stringValue(record.name) ?? `实体 ${index + 1}`,
        source: stringValue(record.source) ?? "entity context",
        detail: [stringValue(record.type), stringValue(record.query), evidence].filter(Boolean).join(" · ") || null,
        summary: stringValue(record.summary),
        url: stringValue(record.url),
        confidence: numberValue(record.confidence),
        verified: booleanValue(record.verified)
      };
    })
    .filter((item) => Boolean(item.title));
}

function normalizeExternalReferences(value: unknown): EvidenceDisplayItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = asRecord(item);
      return {
        kind: "reference",
        title: stringValue(record.title) ?? `引用 ${index + 1}`,
        source: stringValue(record.source) ?? "external source",
        detail: stringValue(record.reason) ?? stringValue(record.publishedAt),
        summary: stringValue(record.snippet),
        url: stringValue(record.url),
        confidence: numberValue(record.relevanceScore),
        verified: stringValue(record.url) ? true : null
      };
    })
    .filter((item) => Boolean(item.title));
}

function normalizeMarketInsights(value: unknown): EvidenceDisplayItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = asRecord(item);
      return {
        kind: "market",
        title: stringValue(record.insight) ?? `市场洞察 ${index + 1}`,
        source: stringArray(record.sourceIds).slice(0, 2).join(" · ") || "agent research",
        detail: [stringValue(record.kind), stringValue(record.detail)].filter(Boolean).join(" · ") || null,
        summary: null,
        url: null,
        confidence: numberValue(record.confidence),
        verified: null
      };
    })
    .filter((item) => Boolean(item.title));
}

function normalizeCompetitorAngles(value: unknown): EvidenceDisplayItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = asRecord(item);
      return {
        kind: "competitor",
        title: stringValue(record.title) ?? `竞品角度 ${index + 1}`,
        source: "competitor SERP",
        detail: stringValue(record.angle),
        summary: null,
        url: stringValue(record.url),
        confidence: null,
        verified: stringValue(record.url) ? true : null
      };
    })
    .filter((item) => Boolean(item.title));
}

function inferEvidenceVerified(record: Record<string, unknown>): boolean | null {
  const type = stringValue(record.type);
  const source = stringValue(record.source)?.toLowerCase() ?? "";
  const url = stringValue(record.url);
  if (type === "product" || type === "collection" || type === "internal_link") return true;
  if (type === "external_reference" || type === "trend") return url ? true : null;
  if (type === "entity_context") {
    const verified = booleanValue(record.verified);
    if (verified !== null) return verified;
    return url ? true : null;
  }
  if (source.includes("shopify")) return true;
  return url ? true : null;
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function toneForScore(score: number | null): "good" | "warn" | "danger" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 85) return "good";
  if (score >= 70) return "warn";
  return "danger";
}

function toneForArticleStatus(status: string): "good" | "warn" | "danger" | "neutral" {
  if (status === "ready_to_publish" || status === "published") return "good";
  if (status === "draft" || status === "publishing") return "warn";
  if (status === "quality_failed" || status === "failed") return "danger";
  return "neutral";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}
