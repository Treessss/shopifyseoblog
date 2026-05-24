import { ArrowRight, Building2, Compass, FlaskConical, Gauge, RefreshCw, Search, Sigma, Sparkles, Telescope, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, StatusPill, TableEmpty } from "@/components/ui";
import { formatPriorityKind, getResearchView } from "@/lib/admin-client";
import { readSearchParam } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const modes = [
  { value: "overview", label: "总览", icon: Telescope },
  { value: "quick_wins", label: "快赢", icon: Sparkles },
  { value: "competitor_gaps", label: "竞争缺口", icon: Compass },
  { value: "topic_clusters", label: "主题集群", icon: Building2 },
  { value: "trends", label: "趋势", icon: TrendingUp },
  { value: "performance_matrix", label: "性能矩阵", icon: Sigma }
] as const;

export default async function ResearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedMode = readSearchParam(params, "mode");
  const mode = modes.some((item) => item.value === requestedMode) ? requestedMode : "overview";
  const { data, error } = await getResearchView(mode as (typeof modes)[number]["value"]);

  const visibleSignals = signalSourceForMode(data, mode);
  const topSignals = visibleSignals.slice(0, 4);

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="研究工作台"
        description="把快赢、竞争缺口、主题集群、趋势和性能矩阵合成一张能直接执行的研究桌面。"
        action={
          <div className="toolbar">
            <Link href="/research" className="button">
              <RefreshCw size={16} aria-hidden="true" />
              刷新研究
            </Link>
            <Link href="/search-console" className="button">
              <Search size={16} aria-hidden="true" />
              打开 Search Console
            </Link>
            <Link href="/campaigns#new-campaign" className="button button--primary">
              <FlaskConical size={16} aria-hidden="true" />
              新建内容任务
            </Link>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="研究工作台读取失败" />

        <div className="insight-strip">
          <StatusPill label="快赢" value={data.summary.quickWins} tone={data.summary.quickWins > 0 ? "good" : "neutral"} icon={<Sparkles size={18} aria-hidden="true" />} />
          <StatusPill label="竞争缺口" value={data.summary.competitorGaps} tone={data.summary.competitorGaps > 0 ? "warn" : "neutral"} icon={<Compass size={18} aria-hidden="true" />} />
          <StatusPill label="主题集群" value={data.summary.clusters} tone={data.summary.clusters > 0 ? "good" : "neutral"} icon={<Building2 size={18} aria-hidden="true" />} />
          <StatusPill label="趋势" value={data.summary.trends} tone={data.summary.trends > 0 ? "good" : "neutral"} icon={<TrendingUp size={18} aria-hidden="true" />} />
        </div>

        <div className="segmented-control research-tabs" role="tablist" aria-label="研究模式">
          {modes.map((item) => {
            const Icon = item.icon;
            const active = item.value === mode;
            const href = item.value === "overview" ? "/research" : `/research?mode=${item.value}`;
            return (
              <Link
                key={item.value}
                href={href}
                className={active ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={15} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="grid research-grid">
          <Panel title="研究摘要" description="把今天最值得做的动作排在前面。">
            <div className="list">
              {topSignals.length === 0 ? (
                <EmptyState
                  title="暂无研究信号"
                  description="先同步 Search Console、优先级板和性能复盘，研究视图会更有内容。"
                />
              ) : (
                topSignals.map((signal) => (
                  <div className="research-row" key={signal.id}>
                    <div>
                      <strong>{signal.title}</strong>
                      <small className="muted">{signal.subtitle}</small>
                      <div className="research-row__meta">
                        <span className="code">{signal.source}</span>
                        {signal.relatedItems.slice(0, 2).map((item) => (
                          <span key={item} className="research-chip">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="row-actions">
                      <Badge tone={toneForLevel(signal.tone)}>{signal.score}</Badge>
                      {signal.actionHref ? (
                        <Link className="button button--small" href={signal.actionHref}>
                          {signal.actionLabel}
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="执行入口" description="直接跳到可操作页面。">
            <div className="list">
              <div className="list-item">
                <div>
                  <strong>内容任务</strong>
                  <small className="muted">把研究信号转成 campaign 和文章。</small>
                </div>
                <Link className="button button--small" href="/campaigns">
                  打开
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
              <div className="list-item">
                <div>
                  <strong>Search Console</strong>
                  <small className="muted">查看站点同步、快照和查询行。</small>
                </div>
                <Link className="button button--small" href="/search-console">
                  打开
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
              <div className="list-item">
                <div>
                  <strong>优先级板</strong>
                  <small className="muted">追踪高优先任务和反思项。</small>
                </div>
                <Link className="button button--small" href="/priorities">
                  打开
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="统一信号流" description="来自 priorities、performance review 和 search console 的合并视图。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>信号</th>
                  <th>来源</th>
                  <th>类型</th>
                  <th>分数</th>
                  <th>证据</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {visibleSignals.length === 0 ? (
                  <TableEmpty colSpan={6} title="暂无研究信号" description="切换模式或先同步底层数据。" />
                ) : (
                  visibleSignals.map((signal) => (
                    <tr key={signal.id}>
                      <td>
                        <strong>{signal.title}</strong>
                        <div className="muted">{signal.subtitle}</div>
                        <div className="muted code">{signal.relatedItems.slice(0, 3).join(" · ") || "无关联项"}</div>
                      </td>
                      <td>
                        <Badge tone="neutral">{signal.source}</Badge>
                      </td>
                      <td>
                        <Badge tone={toneForLevel(signal.tone)}>{formatPriorityKind(signal.kind)}</Badge>
                      </td>
                      <td className="code">{signal.score}</td>
                      <td>
                        <div className="stack stack--tight">
                          {signal.evidence.slice(0, 4).map((item) => (
                            <span key={item} className="muted">
                              {item}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {signal.actionHref ? (
                          <Link className="button button--small" href={signal.actionHref}>
                            {signal.actionLabel}
                            <ArrowRight size={14} aria-hidden="true" />
                          </Link>
                        ) : (
                          <span className="muted">{signal.actionLabel}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid research-grid research-grid--two">
          <Panel title="主题集群" description="按话题聚合的关键词和缺口。">
            <div className="list">
              {data.clusters.length === 0 ? (
                <EmptyState title="暂无集群" description="先积累更多搜索快照与 topic run。" />
              ) : (
                data.clusters.slice(0, 6).map((cluster) => (
                  <div className="research-row" key={`${cluster.topic}-${cluster.primaryKeyword}`}>
                    <div>
                      <strong>{cluster.topic}</strong>
                      <small className="muted">
                        主词 {cluster.primaryKeyword} · {cluster.keywordCount} 关键词 · {cluster.totalImpressions} 展现
                      </small>
                      <div className="research-row__meta">
                        {cluster.topKeywords.slice(0, 3).map((keyword) => (
                          <span key={keyword} className="research-chip">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="row-actions">
                      <Badge tone={cluster.authorityLevel === "Strong" ? "good" : cluster.authorityLevel === "Weak" ? "warn" : "neutral"}>
                        {cluster.authorityLevel}
                      </Badge>
                      {cluster.actionHref ? (
                        <Link className="button button--small" href={cluster.actionHref}>
                          {cluster.actionLabel}
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="趋势" description="正在升温的查询词和对应动作。">
            <div className="list">
              {data.trends.length === 0 ? (
                <EmptyState title="暂无趋势" description="先让 worker 拉到更多搜索数据。" />
              ) : (
                data.trends.slice(0, 6).map((trend) => (
                  <div className="research-row" key={trend.keyword}>
                    <div>
                      <strong>{trend.keyword}</strong>
                      <small className="muted">
                        {trend.searchIntent} · {trend.urgency}
                      </small>
                      <div className="research-row__meta">
                        <span className="code">{trend.impressions} 展现</span>
                        <span className="code">排名 {trend.position ?? "n/a"}</span>
                      </div>
                    </div>
                    <div className="row-actions">
                      <Badge tone={trend.priority === "CRITICAL" ? "danger" : trend.priority === "HIGH" ? "warn" : "neutral"}>
                        {trend.growthPercent > 0 ? `+${trend.growthPercent}%` : `${trend.growthPercent}%`}
                      </Badge>
                      {trend.actionHref ? (
                        <Link className="button button--small" href={trend.actionHref}>
                          去看
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

        <Panel title="性能矩阵" description="用一张表把星标、过强、下滑和低效内容分层。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>内容</th>
                  <th>类别</th>
                  <th>优先级</th>
                  <th>点击</th>
                  <th>展现</th>
                  <th>CTR</th>
                  <th>排名</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {data.performanceMatrix.length === 0 ? (
                  <TableEmpty colSpan={8} title="暂无矩阵" description="先同步 Search Console 和性能复盘。" />
                ) : (
                  data.performanceMatrix.slice(0, 12).map((item) => (
                    <tr key={`${item.title}-${item.path}`}>
                      <td>
                        <strong>{item.title}</strong>
                        <div className="muted code">{item.path || "无路径"}</div>
                      </td>
                      <td>
                        <Badge tone={matrixTone(item.category)}>{item.category}</Badge>
                      </td>
                      <td>
                        <Badge tone={priorityTone(item.priority)}>{item.priority}</Badge>
                      </td>
                      <td className="code">{item.clicks}</td>
                      <td className="code">{item.impressions}</td>
                      <td className="code">{formatPercent(item.ctr)}</td>
                      <td className="code">{item.avgPosition.toFixed(1)}</td>
                      <td>
                        {item.actionHref ? (
                          <Link className="button button--small" href={item.actionHref}>
                            {item.action}
                            <ArrowRight size={14} aria-hidden="true" />
                          </Link>
                        ) : (
                          <span className="muted">{item.action}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel compact>
          <div className="list-item">
            <Gauge size={18} aria-hidden="true" />
            <div>
              <strong>研究节奏</strong>
              <small className="muted">
                先看 overview，再按快赢、缺口、集群、趋势和矩阵拆动作，最后跳到 campaign 或 Search Console 执行。
              </small>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function signalSourceForMode(data: Awaited<ReturnType<typeof getResearchView>>["data"], mode: string) {
  if (mode === "quick_wins") return data.signals.filter((signal) => signal.kind === "quick_win");
  if (mode === "competitor_gaps") return data.signals.filter((signal) => signal.kind === "gap" || signal.kind === "declining");
  if (mode === "topic_clusters") return data.signals.filter((signal) => signal.kind === "cluster" || signal.kind === "topic_opportunity");
  if (mode === "trends") return data.signals.filter((signal) => signal.kind === "trend");
  if (mode === "performance_matrix") {
    return data.signals.filter((signal) => signal.kind === "matrix" || signal.kind === "low_ctr");
  }
  return data.signals;
}

function toneForLevel(level: string) {
  if (level === "critical" || level === "high") return level === "critical" ? "danger" : "warn";
  if (level === "low" || level === "good") return "good";
  return "neutral";
}

function priorityTone(priority: string) {
  if (priority === "CRITICAL") return "danger";
  if (priority === "HIGH") return "warn";
  if (priority === "LOW") return "good";
  return "neutral";
}

function matrixTone(category: string) {
  if (category === "Star") return "good";
  if (category === "Declining") return "danger";
  if (category === "Overperformer") return "warn";
  return "neutral";
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
