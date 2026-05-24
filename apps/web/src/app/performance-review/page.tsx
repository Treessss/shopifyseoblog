import { ArrowRight, CopyPlus, RefreshCw, Gauge, Flame, ListTodo, TriangleAlert, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, StatusPill, TableEmpty } from "@/components/ui";
import { formatPriorityKind, formatPriorityLevel, getPerformanceReviewView } from "@/lib/admin-client";
import { readSearchParam } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PerformanceReviewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const level = readSearchParam(params, "level");
  const kind = readSearchParam(params, "kind");
  const query = readSearchParam(params, "q").trim().toLowerCase();
  const { data, error } = await getPerformanceReviewView();

  const filtered = data.items.filter((item) => {
    const matchesLevel = !level || item.level === level;
    const matchesKind = !kind || item.kind === kind;
    const matchesQuery =
      !query ||
      `${item.title} ${item.summary} ${item.reason} ${item.store ?? ""} ${item.article ?? ""}`.toLowerCase().includes(query);
    return matchesLevel && matchesKind && matchesQuery;
  });

  const topThree = filtered.slice(0, 3);
  const criticalCount = data.items.filter((item) => item.level === "high").length;

  return (
    <>
      <PageHeader
        eyebrow="Performance Review"
        title="性能复盘作战板"
        description="把 Search Console、快赢、下滑、低 CTR、主题机会和 agent 风险重新排成今天该做的动作。"
        action={
          <div className="toolbar">
            <Link href="/performance-review" className="button">
              <RefreshCw size={16} aria-hidden="true" />
              刷新复盘
            </Link>
            <Link href="/priorities" className="button button--primary">
              <Gauge size={16} aria-hidden="true" />
              打开优先级板
            </Link>
            <Link href="/campaigns#new-campaign" className="button">
              <CopyPlus size={16} aria-hidden="true" />
              新建内容任务
            </Link>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="性能复盘读取失败" />

        <div className="insight-strip">
          <StatusPill label="快赢" value={data.summary.quickWins} tone={data.summary.quickWins > 0 ? "good" : "neutral"} icon={<Flame size={18} aria-hidden="true" />} />
          <StatusPill label="下滑" value={data.summary.declining} tone={data.summary.declining > 0 ? "warn" : "neutral"} icon={<TriangleAlert size={18} aria-hidden="true" />} />
          <StatusPill label="低 CTR" value={data.summary.lowCtr} tone={data.summary.lowCtr > 0 ? "warn" : "neutral"} icon={<Search size={18} aria-hidden="true" />} />
          <StatusPill label="趋势" value={data.summary.trends} tone={data.summary.trends > 0 ? "good" : "neutral"} icon={<Gauge size={18} aria-hidden="true" />} />
          <StatusPill label="潜在点击" value={`+${data.summary.totalPotentialClicks}`} tone="neutral" icon={<Gauge size={18} aria-hidden="true" />} />
        </div>

        <div className="grid grid--two">
          <Panel title="复盘摘要" description="先修 page 2 快赢，再处理高曝光低 CTR 和明显下滑。">
            <div className="list">
              <div className="list-item">
                <div>
                  <strong>本周先做什么</strong>
                  <small className="muted">处理 quick win 和低 CTR 文章，优先拿到最容易吃到的流量。</small>
                </div>
                <Badge tone="good">快赢优先</Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>再看什么</strong>
                  <small className="muted">下滑内容和 agent step 告警，防止内容质量继续掉。</small>
                </div>
                <Badge tone="warn">止损</Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>最后做什么</strong>
                  <small className="muted">主题机会和记忆风险会告诉你下一篇该从哪里起手。</small>
                </div>
                <Badge tone="neutral">扩张</Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>直接去做</strong>
                  <small className="muted">可以从复盘页直接跳到内容任务页，把趋势或快赢转成新任务。</small>
                </div>
                <Link className="button button--small" href="/campaigns#new-campaign">
                  去创建
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Panel>

          <Panel title="筛选器" description="按复盘类型和严重程度收缩队列。">
            <form className="filter-bar" action="/performance-review">
              <label className="filter-field">
                <Search size={15} aria-hidden="true" />
                <input name="q" defaultValue={readSearchParam(params, "q")} placeholder="搜索标题、原因、店铺或文章" />
              </label>
              <label className="filter-select">
                <span>级别</span>
                <select name="level" defaultValue={level}>
                  <option value="">全部</option>
                  {["critical", "high", "medium", "low"].map((item) => (
                    <option key={item} value={item}>
                      {formatPriorityLevel(item)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-select">
                <span>类型</span>
                <select name="kind" defaultValue={kind}>
                  <option value="">全部</option>
                  {["quick_win", "declining", "low_ctr", "topic_opportunity", "trend", "memory_risk", "agent_step"].map((item) => (
                    <option key={item} value={item}>
                      {formatPriorityKind(item)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button" type="submit">
                <RefreshCw size={16} aria-hidden="true" />
                应用
              </button>
              <span className="filter-bar__summary">当前 {filtered.length} 条任务</span>
            </form>
          </Panel>
        </div>

        <Panel title="Top 3 复盘动作" description="按 score 排序的前三条任务，适合今天先做。">
          <div className="list">
            {topThree.length === 0 ? (
              <EmptyState
                title="暂无复盘任务"
                description="先让 worker 同步更多 Search Console、query row 和 agent 结果，复盘会更有东西。"
              />
            ) : (
              topThree.map((item) => (
                <div className="list-item" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <small className="muted">
                      {formatPriorityKind(item.kind)} · {item.reason}
                    </small>
                  </div>
                  <div className="row-actions">
                    <Badge tone={toneForLevel(item.level)}>{formatPriorityLevel(item.level)}</Badge>
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

        <Panel title="完整复盘" description="把每个信号重新排成一张动作表。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>类型</th>
                  <th>级别</th>
                  <th>分数</th>
                  <th>信号</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <TableEmpty
                    colSpan={6}
                    title={data.items.length === 0 ? "暂无复盘信号" : "没有匹配的任务"}
                    description={
                      data.items.length === 0
                        ? "先让 worker 同步更多 Search Console 和 agent 数据。"
                        : "调整搜索或筛选条件。"
                    }
                  />
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        <div className="muted">{item.summary}</div>
                        <div className="muted code">
                          {item.store ?? "全局"}{item.article ? ` · ${item.article}` : ""}
                        </div>
                      </td>
                      <td>
                        <Badge tone="neutral">{formatPriorityKind(item.kind)}</Badge>
                      </td>
                      <td>
                        <Badge tone={toneForLevel(item.level)}>{formatPriorityLevel(item.level)}</Badge>
                      </td>
                      <td className="code">{item.score}</td>
                      <td>
                        <div className="stack stack--tight">
                          {item.evidence.slice(0, 4).map((signal) => (
                            <span key={signal} className="muted">
                              {signal}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
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
                        ) : (
                          <span className="muted">无动作</span>
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
            <ShieldAlert size={18} aria-hidden="true" />
            <div>
              <strong>复盘顺序</strong>
              <small className="muted">先 quick win，再 low CTR 和 declining，然后看 trend、topic opportunity 和 memory risk。</small>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function toneForLevel(level: string) {
  if (level === "high") return "danger";
  if (level === "medium") return "warn";
  if (level === "low") return "good";
  return "neutral";
}
