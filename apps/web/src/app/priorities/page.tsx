import { ArrowRight, Flame, Gauge, ListTodo, RefreshCw, Search, ShieldAlert, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, StatusPill, TableEmpty } from "@/components/ui";
import {
  formatPriorityKind,
  formatPriorityLevel,
  getPrioritiesView
} from "@/lib/admin-client";
import { readSearchParam } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PrioritiesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const level = readSearchParam(params, "level");
  const kind = readSearchParam(params, "kind");
  const query = readSearchParam(params, "q").trim().toLowerCase();
  const { data, error } = await getPrioritiesView();

  const filtered = data.items.filter((item) => {
    const matchesLevel = !level || item.level === level;
    const matchesKind = !kind || item.kind === kind;
    const matchesQuery =
      !query ||
      `${item.title} ${item.summary} ${item.reason} ${item.store ?? ""} ${item.article ?? ""} ${item.campaign ?? ""}`
        .toLowerCase()
        .includes(query);
    return matchesLevel && matchesKind && matchesQuery;
  });

  const topThree = filtered.slice(0, 3);
  const quickWinCount = data.summary.quickWins;
  const criticalCount = data.items.filter((item) => item.level === "critical").length;

  return (
    <>
      <PageHeader
        eyebrow="Priorities"
        title="优先级作战板"
        description="把 Search Console、agent memory、topic run 和反思任务压成一个可执行队列。"
        action={
          <div className="toolbar">
            <Link href="/priorities" className="button">
              <RefreshCw size={16} aria-hidden="true" />
              刷新队列
            </Link>
            <Link href="/campaigns" className="button button--primary">
              <Sparkles size={16} aria-hidden="true" />
              新建内容任务
            </Link>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="优先级板读取失败" />

        <div className="insight-strip">
          <StatusPill label="快赢" value={quickWinCount} tone={quickWinCount > 0 ? "good" : "neutral"} icon={<Flame size={18} aria-hidden="true" />} />
          <StatusPill label="关键任务" value={criticalCount} tone={criticalCount > 0 ? "danger" : "good"} icon={<TriangleAlert size={18} aria-hidden="true" />} />
          <StatusPill label="反思任务" value={data.summary.reflectionTasks} tone={data.summary.reflectionTasks > 0 ? "warn" : "neutral"} icon={<ListTodo size={18} aria-hidden="true" />} />
          <StatusPill label="预估点击增量" value={`+${data.summary.potentialClickGain}`} tone="neutral" icon={<Gauge size={18} aria-hidden="true" />} />
        </div>

        <div className="grid grid--two">
          <Panel title="优先级摘要" description="seomachine 风格的行动顺序：先快赢，再止损，再做新机会。">
            <div className="list">
              <div className="list-item">
                <div>
                  <strong>优先做什么</strong>
                  <small className="muted">先处理位于 11-20 位的快赢、再处理高曝光低 CTR 内容。</small>
                </div>
                <Badge tone="good">快赢优先</Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>为什么现在做</strong>
                  <small className="muted">agent memory 和 topic run 已经记录了过去的成功与失败模式。</small>
                </div>
                <Badge tone="warn">记忆驱动</Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>能直接执行的动作</strong>
                  <small className="muted">每条任务都带动作按钮，直接跳到文章、任务或同步动作。</small>
                </div>
                <Badge tone="neutral">Actionable</Badge>
              </div>
            </div>
          </Panel>

          <Panel title="筛选器" description="按机会类型和严重级别收缩视野，先把最值得干的挑出来。">
            <form className="filter-bar" action="/priorities">
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
                  {[
                    "quick_win",
                    "declining",
                    "low_ctr",
                    "topic_opportunity",
                    "reflection_task",
                    "agent_step",
                    "memory_risk"
                  ].map((item) => (
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

        <Panel title="Top 3 行动" description="按 score 排序的前三条优先级任务，适合今天就处理。">
          <div className="list">
            {topThree.length === 0 ? (
              <EmptyState
                title="暂无优先任务"
                description="当前没有足够强的快赢、反思或风险信号。可先同步 Search Console 或运行新的 topic agent。"
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
                    {item.actionHref ? (
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

        <Panel title="完整队列" description="这张表把每个机会变成可执行项，不再只是分析结论。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>类型</th>
                  <th>级别</th>
                  <th>分数</th>
                  <th>证据</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <TableEmpty
                    colSpan={6}
                    title={data.items.length === 0 ? "暂无可执行任务" : "没有匹配的任务"}
                    description={
                      data.items.length === 0
                        ? "先让 worker 同步更多 Search Console 和 agent 数据，队列会更有东西。"
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
                          {item.evidence.slice(0, 3).map((evidence) => (
                            <span key={evidence} className="muted">
                              {evidence}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {item.actionHref ? (
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
              <strong>执行顺序</strong>
              <small className="muted">先处理 critical 和 high，再看 medium。快赢、下滑、低 CTR、记忆风险都能直接跳到相关页面。</small>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function toneForLevel(level: string) {
  if (level === "critical") return "danger";
  if (level === "high") return "warn";
  if (level === "medium") return "neutral";
  return "good";
}
