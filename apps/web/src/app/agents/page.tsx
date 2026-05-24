import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  CircleCheckBig,
  FileSearch,
  Gauge,
  ListTodo,
  Megaphone,
  PenLine,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow
} from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, StatusPill } from "@/components/ui";
import {
  formatPriorityKind,
  getDashboardView,
  getPerformanceReviewView,
  getPrioritiesView,
  getResearchView
} from "@/lib/admin-client";
import {
  createPythonAgentSnapshot,
  createPythonWorkflowPlan,
  getPythonAgentSnapshot,
  getPythonSeoBoard,
  type PythonWorkflowPlanRequest
} from "@/lib/agent-center/python-agent-client";

export default async function AgentsPage() {
  const [dashboard, priorities, performance, research] = await Promise.all([
    getDashboardView(),
    getPrioritiesView(),
    getPerformanceReviewView(),
    getResearchView("overview")
  ]);
  const organization = priorities.data.organization ?? performance.data.organization ?? research.data.organization;
  const [pythonSnapshot, pythonSeoBoard] = await Promise.all([
    getPythonAgentSnapshot(),
    getPythonSeoBoard()
  ]);
  const workflowRequest: PythonWorkflowPlanRequest = {
    organization_id: organization.id || "demo",
    store_id: dashboard.data.stores[0]?.id ?? "demo-store",
    locale: organization.locale || "zh-CN",
    topic: research.data.signals[0]?.title ?? priorities.data.items[0]?.title ?? "Shopify SEO growth opportunity",
    primary_keyword: research.data.signals[0]?.title ?? priorities.data.items[0]?.title ?? "shopify seo",
    publish_policy: "manual_review",
    target_word_count: 1600,
    available_internal_links: dashboard.data.articles.length,
    available_external_references: research.data.signals.length,
    recent_topic_count: priorities.data.items.length,
    search_console_connected: dashboard.data.stores.length > 0
  };
  const [pythonPlan, plannedPythonSnapshot] = await Promise.all([
    createPythonWorkflowPlan(workflowRequest),
    createPythonAgentSnapshot(workflowRequest)
  ]);
  const visiblePythonSnapshot = plannedPythonSnapshot ?? pythonSnapshot;
  const queueHealth = dashboard.data.queueHealth;
  const activeCampaigns = dashboard.data.campaigns.filter((campaign) => campaign.status === "active");
  const stalledCampaigns = activeCampaigns.filter((campaign) => campaign.progressIsStale);
  const blockedArticles = dashboard.data.articles.filter((article) => article.status === "quality_failed" || article.status === "failed");
  const readyArticles = dashboard.data.articles.filter((article) => article.status === "ready_to_publish");
  const nextAction = resolveNextAction({
    healthyStores: dashboard.data.stores.filter((store) => store.statusTone === "good").length,
    activeCampaigns: activeCampaigns.length,
    stalledCampaigns: stalledCampaigns.length,
    blockedArticles: blockedArticles.length,
    readyArticles: readyArticles.length,
    queueTone: queueHealth.tone
  });
  const agentCards = [
    {
      name: "Research Agent",
      role: "选题与证据",
      status: research.data.summary.opportunities > 0 ? "有机会" : "待积累",
      tone: research.data.summary.opportunities > 0 ? "good" as const : "neutral" as const,
      metric: research.data.summary.opportunities,
      detail: "从 Search Console、趋势、竞品角度和店铺数据里找下一篇要写什么。",
      href: "/research",
      icon: <Radar size={19} aria-hidden="true" />
    },
    {
      name: "Writer Agent",
      role: "内容生成",
      status: stalledCampaigns.length > 0 ? "可能卡住" : activeCampaigns.length > 0 ? "执行中" : "待任务",
      tone: stalledCampaigns.length > 0 ? "danger" as const : activeCampaigns.length > 0 ? "warn" as const : "neutral" as const,
      metric: activeCampaigns.length,
      detail: "把选题、关键词、内链和引用变成 Shopify 可用文章。",
      href: "/campaigns",
      icon: <PenLine size={19} aria-hidden="true" />
    },
    {
      name: "SEO Gate Agent",
      role: "质量门禁",
      status: blockedArticles.length > 0 ? "需修复" : "正常",
      tone: blockedArticles.length > 0 ? "danger" as const : "good" as const,
      metric: blockedArticles.length,
      detail: "检查标题、摘要、H2、内链、外部引用、事实边界和 AI 搜索分。",
      href: "/articles",
      icon: <ShieldCheck size={19} aria-hidden="true" />
    },
    {
      name: "Publisher Agent",
      role: "发布与同步",
      status: readyArticles.length > 0 ? "待发布" : "空闲",
      tone: readyArticles.length > 0 ? "good" as const : "neutral" as const,
      metric: readyArticles.length,
      detail: "把合格文章发布到 Shopify，并在上线后接 Search Console 复盘。",
      href: "/articles?status=ready_to_publish",
      icon: <CircleCheckBig size={19} aria-hidden="true" />
    },
    {
      name: "Growth Agent",
      role: "复盘优化",
      status: performance.data.summary.quickWins > 0 ? "有快赢" : "观察中",
      tone: performance.data.summary.quickWins > 0 ? "good" as const : "neutral" as const,
      metric: performance.data.summary.quickWins,
      detail: "找 page 2 快赢、低 CTR、下滑内容和下一轮增长实验。",
      href: "/performance-review",
      icon: <Activity size={19} aria-hidden="true" />
    }
  ];
  const topWork = [...priorities.data.items, ...performance.data.items]
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);
  return (
    <>
      <PageHeader
        eyebrow="Agent Center"
        title="AI Agent 指挥中心"
        description="所有流程先回到这一页：看当前卡在哪个智能体、下一步该点哪里，以及哪些文章已经能进入收录和排名复盘。"
        action={
          <div className="toolbar">
            <Link href="/agents" className="button">
              <RefreshCw size={16} aria-hidden="true" />
              刷新
            </Link>
            <Link href={nextAction.href} className="button button--primary">
              <Sparkles size={16} aria-hidden="true" />
              {nextAction.label}
            </Link>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={dashboard.error} title="Agent 状态读取失败" />
        <ErrorState error={priorities.error} title="优先级读取失败" />
        <ErrorState error={performance.error} title="复盘读取失败" />
        <ErrorState error={research.error} title="研究状态读取失败" />

        <Panel
          title="现在从这里开始"
          description="系统只给一个主动作，其他页面都是这个动作的支撑。"
          action={
            <Link href={nextAction.href} className="button button--primary">
              {nextAction.label}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          }
        >
          <div className="agent-command">
            <div>
              <strong>{nextAction.title}</strong>
              <p className="muted">{nextAction.description}</p>
            </div>
            <div className="agent-command__flow" aria-label="Agent workflow">
              <span>研究</span>
              <ArrowRight size={15} aria-hidden="true" />
              <span>写作</span>
              <ArrowRight size={15} aria-hidden="true" />
              <span>质检</span>
              <ArrowRight size={15} aria-hidden="true" />
              <span>发布</span>
              <ArrowRight size={15} aria-hidden="true" />
              <span>复盘</span>
            </div>
          </div>
        </Panel>

        {visiblePythonSnapshot ? (
          <Panel title="Python Agent Snapshot" description="由 Python 后端根据店铺、选题、证据和阻塞项推导的智能体编排状态。">
            <div className="insight-strip">
              <StatusPill label="编排模式" value={visiblePythonSnapshot.orchestration_mode} tone="neutral" icon={<BrainCircuit size={18} aria-hidden="true" />} />
              <StatusPill label="当前阶段" value={visiblePythonSnapshot.active_stage ?? "planning"} tone="warn" icon={<Workflow size={18} aria-hidden="true" />} />
              <StatusPill label="已完成" value={visiblePythonSnapshot.completed_agents_total} tone="good" icon={<CircleCheckBig size={18} aria-hidden="true" />} />
              <StatusPill label="运行中" value={visiblePythonSnapshot.running_agents_total} tone={visiblePythonSnapshot.running_agents_total > 0 ? "warn" : "neutral"} icon={<Bot size={18} aria-hidden="true" />} />
              <StatusPill label="排队中" value={visiblePythonSnapshot.queued_agents_total} tone={visiblePythonSnapshot.queued_agents_total > 0 ? "neutral" : "good"} icon={<ListTodo size={18} aria-hidden="true" />} />
              <StatusPill label="被阻塞" value={visiblePythonSnapshot.blocked_agents_total} tone={visiblePythonSnapshot.blocked_agents_total > 0 ? "danger" : "good"} icon={<ShieldCheck size={18} aria-hidden="true" />} />
              <StatusPill label="证据节点" value={visiblePythonSnapshot.evidence_total} tone="good" icon={<FileSearch size={18} aria-hidden="true" />} />
              <StatusPill label="开放任务" value={visiblePythonSnapshot.open_tasks_total} tone={visiblePythonSnapshot.open_tasks_total > 0 ? "warn" : "good"} icon={<ListTodo size={18} aria-hidden="true" />} />
              <StatusPill label="流程完成" value={`${visiblePythonSnapshot.workflow_completion}%`} tone={visiblePythonSnapshot.workflow_completion >= 100 ? "good" : visiblePythonSnapshot.workflow_completion >= 50 ? "warn" : "neutral"} icon={<Gauge size={18} aria-hidden="true" />} />
            </div>
            <div className="list">
              {visiblePythonSnapshot.agents.map((agent) => (
                <div className="list-item" key={agent.role}>
                  <div>
                    <strong>{agent.name}</strong>
                    <small className="muted">
                      #{agent.queue_position} · {agent.display_state ?? agent.status} · {agent.current_step ?? agent.responsibility}
                    </small>
                    {agent.state_reason ? <small className="muted">{agent.state_reason}</small> : null}
                    {agent.next_step ? <small className="muted">下一步：{agent.next_step}</small> : null}
                    {agent.outputs.length > 0 ? <small className="muted">产物：{agent.outputs.join(" · ")}</small> : null}
                    {agent.blockers.length > 0 ? <small className="muted">阻塞：{agent.blockers.join(" · ")}</small> : null}
                  </div>
                  <Badge tone={agent.display_state === "blocked" ? "danger" : agent.display_state === "active" ? "warn" : agent.display_state === "complete" ? "good" : "neutral"}>
                    {agent.display_state ?? agent.status}
                  </Badge>
                </div>
              ))}
              <div className="list-item">
                <div>
                  <strong>Python 下一步</strong>
                  <small className="muted">{visiblePythonSnapshot.next_action}</small>
                </div>
              </div>
              {visiblePythonSnapshot.doctrine_sources.length > 0 ? (
                <div className="list-item">
                  <div>
                    <strong>Agent 规则来源</strong>
                    <small className="muted">{visiblePythonSnapshot.doctrine_sources.join(" · ")}</small>
                  </div>
                </div>
              ) : null}
              {visiblePythonSnapshot.warnings.length > 0 ? (
                <div className="list-item">
                  <div>
                    <strong>运行提醒</strong>
                    <small className="muted">{visiblePythonSnapshot.warnings.join(" · ")}</small>
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>
        ) : null}

        {pythonPlan ? (
          <Panel title="Python Workflow Plan" description="后端即将执行的内容工作流计划。">
            <div className="list">
              <div className="list-item">
                <div>
                  <strong>{pythonPlan.topic}</strong>
                  <small className="muted">
                    {pythonPlan.primary_keyword} · {pythonPlan.publish_policy}
                  </small>
                </div>
                <Badge tone={pythonPlan.blockers.length > 0 ? "warn" : "good"}>
                  {pythonPlan.blockers.length > 0 ? `${pythonPlan.blockers.length} blockers` : "ready"}
                </Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>下一步</strong>
                  <small className="muted">{pythonPlan.next_step}</small>
                </div>
              </div>
            </div>
          </Panel>
        ) : null}

        {pythonSeoBoard ? (
          <Panel title="Python SEO Strategy Board" description="后端按 quick wins、竞品缺口和内容矩阵合成的策略优先级。">
            <div className="readiness-summary">
              <div>
                <strong>{pythonSeoBoard.summary}</strong>
                <small className="muted">质量策略分 {pythonSeoBoard.quality_score}/100，来自 Python SEO domain。</small>
              </div>
              <Badge tone={pythonSeoBoard.quality_score >= 70 ? "good" : "warn"}>{pythonSeoBoard.quality_score}</Badge>
            </div>
            <div className="list">
              {pythonSeoBoard.recommendations.slice(0, 4).map((item) => (
                <div className="list-item" key={`${item.source}-${item.title}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <small className="muted">{item.reason}</small>
                  </div>
                  <Badge tone={item.priority === "critical" || item.priority === "high" ? "warn" : "neutral"}>
                    {item.source}
                  </Badge>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        <div className="insight-strip">
          <StatusPill label="队列状态" value={queueHealth.label} tone={queueHealth.tone} icon={<Workflow size={18} aria-hidden="true" />} />
          <StatusPill label="正在执行" value={activeCampaigns.length + queueHealth.runningJobs + queueHealth.retryingJobs} tone={queueHealth.activeJobs > 0 ? "warn" : "neutral"} icon={<Bot size={18} aria-hidden="true" />} />
          <StatusPill label="可能卡住" value={stalledCampaigns.length} tone={stalledCampaigns.length > 0 ? "danger" : "good"} icon={<RefreshCw size={18} aria-hidden="true" />} />
          <StatusPill label="需修复文章" value={blockedArticles.length} tone={blockedArticles.length > 0 ? "danger" : "good"} icon={<FileSearch size={18} aria-hidden="true" />} />
          <StatusPill label="待发布" value={readyArticles.length} tone={readyArticles.length > 0 ? "good" : "neutral"} icon={<Megaphone size={18} aria-hidden="true" />} />
          <StatusPill label="快赢机会" value={performance.data.summary.quickWins} tone={performance.data.summary.quickWins > 0 ? "good" : "neutral"} icon={<Gauge size={18} aria-hidden="true" />} />
        </div>

        <div className="agent-grid">
          {agentCards.map((agent) => (
            <Link className="agent-card" href={agent.href} key={agent.name}>
              <div className={`agent-card__icon agent-card__icon--${agent.tone}`}>{agent.icon}</div>
              <div>
                <div className="agent-card__head">
                  <strong>{agent.name}</strong>
                  <Badge tone={agent.tone}>{agent.status}</Badge>
                </div>
                <small className="muted">{agent.role}</small>
                <p>{agent.detail}</p>
              </div>
              <span className="agent-card__metric">{agent.metric}</span>
            </Link>
          ))}
        </div>

        <div className="grid grid--two">
          <Panel title="卡住时先看这里" description="生成不动时，先确认是排队、执行、失败，还是需要配置。">
            <div className="list">
              <div className="list-item">
                <div>
                  <strong>{queueHealth.nextStep}</strong>
                  <small className="muted">当前排队 {queueHealth.queuedJobs}，执行 {queueHealth.runningJobs}，重试 {queueHealth.retryingJobs}，失败 {queueHealth.failedJobs}，可能卡住 {stalledCampaigns.length}。</small>
                </div>
                <Badge tone={queueHealth.tone}>{queueHealth.label}</Badge>
              </div>
              {stalledCampaigns[0] ? (
                <div className="list-item">
                  <div>
                    <strong>{stalledCampaigns[0].name}</strong>
                    <small className="muted">{stalledCampaigns[0].progressStaleReason ?? "任务较久没有进度心跳，建议去任务页处理。"}</small>
                  </div>
                  <Link className="button button--small" href="/campaigns?status=active">
                    处理
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              ) : null}
              {queueHealth.lastFailedMessage ? (
                <div className="list-item">
                  <div>
                    <strong>最近失败</strong>
                    <small className="muted">{queueHealth.lastFailedMessage}</small>
                  </div>
                  <Link className="button button--small" href="/logs">
                    日志
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              ) : null}
              <div className="list-item">
                <div>
                  <strong>修复是做什么</strong>
                  <small className="muted">不是简单重跑，而是按 analyze-existing → rewrite → optimize → performance-review 重新改稿。</small>
                </div>
                <Link className="button button--small" href="/articles">
                  文章
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Panel>

          <Panel title="SEO 收录判断" description="能发布不等于一定排名，系统会把收录准备和增长复盘拆开。">
            <div className="list">
              <SeoGateRow title="可收录基础" value="质量过线 + 已发布 + canonical" tone={readyArticles.length > 0 ? "warn" : "neutral"} />
              <SeoGateRow title="可提升排名" value="有搜索意图、证据、内链、引用和复盘数据" tone={performance.data.summary.quickWins > 0 ? "good" : "neutral"} />
              <SeoGateRow title="还不能保证" value="Google 是否收录、排名和点击，需要上线后用 Search Console 验证" tone="warn" />
              <div className="list-item">
                <div>
                  <strong>下一步验证</strong>
                  <small className="muted">发布后同步 Search Console，再看曝光、平均排名、CTR 和低点击 query。</small>
                </div>
                <Link className="button button--small" href="/search-console">
                  同步
                  <Search size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="今天的 Agent 工作队列" description="按影响分排序，先处理这些动作。">
          <div className="list">
            {topWork.length === 0 ? (
              <EmptyState title="暂无待办" description="先创建内容任务或同步 Search Console，Agent 会把结果排进这里。" />
            ) : (
              topWork.map((item) => (
                <div className="list-item" key={`${item.kind}-${item.id}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <small className="muted">
                      {formatPriorityKind(item.kind)} · {item.reason}
                    </small>
                  </div>
                  <div className="row-actions">
                    <Badge tone={item.level === "critical" || item.level === "high" ? "warn" : "neutral"}>{item.score}</Badge>
                    {item.actionType === "repair_article" && item.articleId ? (
                      <form action={`/api/admin/articles/${item.articleId}/repair`} method="post">
                        <input type="hidden" name="repairReason" value={item.repairReason ?? item.reason} />
                        <button className="button button--small" type="submit">
                          {item.actionLabel}
                          <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </form>
                    ) : item.actionHref ? (
                      <Link className="button button--small" href={item.actionHref}>
                        {item.actionLabel}
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

function SeoGateRow(props: { title: string; value: string; tone: "good" | "warn" | "danger" | "neutral" }) {
  return (
    <div className="list-item">
      <div>
        <strong>{props.title}</strong>
        <small className="muted">{props.value}</small>
      </div>
      <Badge tone={props.tone}>{props.tone === "good" ? "达标" : props.tone === "warn" ? "待验证" : "观察"}</Badge>
    </div>
  );
}

function resolveNextAction(input: {
  healthyStores: number;
  activeCampaigns: number;
  stalledCampaigns: number;
  blockedArticles: number;
  readyArticles: number;
  queueTone: "good" | "warn" | "danger" | "neutral";
}) {
  if (input.healthyStores === 0) {
    return {
      title: "先连接或同步 Shopify 店铺",
      description: "没有店铺数据，Agent 不能可靠读取商品、集合、内链和发布目标。",
      label: "连接店铺",
      href: "/stores"
    };
  }
  if (input.queueTone === "danger") {
    return {
      title: "先处理失败任务",
      description: "队列里有失败任务，先看日志和错误原因，再继续生成新文章。",
      label: "看日志",
      href: "/logs"
    };
  }
  if (input.stalledCampaigns > 0) {
    return {
      title: "先处理可能卡住的生成任务",
      description: "任务长时间没有进度心跳。先看任务页的停滞原因，必要时从草稿继续 AI 修复。",
      label: "处理卡住任务",
      href: "/campaigns?status=active"
    };
  }
  if (input.activeCampaigns > 0) {
    return {
      title: "等待当前内容任务跑完",
      description: "任务正在生成或质检。先看任务进度，不要重复创建相同选题。",
      label: "看任务",
      href: "/campaigns"
    };
  }
  if (input.blockedArticles > 0) {
    return {
      title: "先修复未过线文章",
      description: "这些文章还不能说已经具备 Google 收录和排名基础，优先让 SEO Gate Agent 修复。",
      label: "修复文章",
      href: "/articles"
    };
  }
  if (input.readyArticles > 0) {
    return {
      title: "发布已经过线的文章",
      description: "质量门禁通过后，下一步是发布到 Shopify，让 Google 有线上页面可抓取。",
      label: "发布文章",
      href: "/articles?status=ready_to_publish"
    };
  }
  return {
    title: "创建下一篇内容任务",
    description: "从研究信号或手动主题开始，让 Agent 完成选题、写作、质检和发布前检查。",
    label: "新建任务",
    href: "/campaigns#new-campaign"
  };
}
