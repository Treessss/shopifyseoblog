import Link from "next/link";
import { Activity, RefreshCw, Search } from "lucide-react";
import { Badge, ErrorState, PageHeader, Panel, TableEmpty } from "@/components/ui";
import { formatJobStatus, formatLogLevel, getLogsView } from "@/lib/admin-client";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function param(params: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function LogsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = param(params, "q").trim().toLowerCase();
  const level = param(params, "level");
  const { data: logs, error } = await getLogsView();
  const filteredLogs = logs.filter((log) => {
    const matchesQuery = !query || `${log.message} ${log.module} ${log.status}`.toLowerCase().includes(query);
    const matchesLevel = !level || log.level === level;
    return matchesQuery && matchesLevel;
  });

  return (
    <>
      <PageHeader
        eyebrow="Logs"
        title="运行日志"
        description="追踪内容生成、Shopify 同步、发布和 webhook 处理事件。"
        action={
          <Link href="/logs" className="button">
            <RefreshCw size={16} aria-hidden="true" />
            刷新日志
          </Link>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="日志数据读取失败" />

        <Panel title="最近事件" description="可按模块、任务 ID、严重级别和状态排查生成、同步与发布问题。">
          <form className="filter-bar" action="/logs">
            <label className="filter-field">
              <Search size={15} aria-hidden="true" />
              <input name="q" defaultValue={param(params, "q")} placeholder="搜索模块、状态或消息" />
            </label>
            <label className="filter-select">
              <span>级别</span>
              <select name="level" defaultValue={level}>
                <option value="">全部</option>
                {[...new Set(logs.map((log) => log.level))].map((item) => (
                  <option key={item} value={item}>
                    {formatLogLevel(item)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button" type="submit">
              筛选
            </button>
            <span className="filter-bar__summary">当前 {filteredLogs.length} 条事件</span>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>级别</th>
                  <th>模块</th>
                  <th>消息</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <TableEmpty
                    colSpan={5}
                    title={logs.length === 0 ? "暂无日志事件" : "没有匹配的日志"}
                    description={
                      logs.length === 0
                        ? "发布、同步、生成和审计事件会从管理端日志接口进入这里。"
                        : "调整搜索关键词或级别筛选条件。"
                    }
                  />
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="code">{log.time}</td>
                      <td>
                        <Badge tone={log.levelTone}>{formatLogLevel(log.level)}</Badge>
                      </td>
                      <td className="code">{log.module}</td>
                      <td>{log.message}</td>
                      <td>
                        <Badge tone={log.statusTone}>{formatJobStatus(log.status)}</Badge>
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
            <Activity size={18} aria-hidden="true" />
            <div>
              <strong>告警策略</strong>
              <small className="muted">失败发布、授权过期和同步延迟会进入待处理队列；日志页只展示来自管理端接口的真实事件。</small>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
