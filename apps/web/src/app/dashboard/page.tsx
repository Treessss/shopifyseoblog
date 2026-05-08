import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Badge, MetricCard, PageHeader, Panel, ProgressBar } from "@/components/ui";
import { articles, campaigns, logs, metrics, stores } from "@/lib/admin-data";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="内容增长仪表盘"
        description="集中查看多店铺内容生产、质量门槛、发布状态和近期异常，默认以简体中文呈现。"
        action={
          <button className="button">
            <RefreshCw size={16} aria-hidden="true" />
            刷新数据
          </button>
        }
      />

      <div className="grid grid--metrics">
        {metrics.map((item) => (
          <MetricCard key={item.label} {...item} />
        ))}
      </div>

      <div className="grid grid--two" style={{ marginTop: 16 }}>
        <Panel title="活跃内容任务" description="按任务进度、发布策略和语种追踪生产节奏。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>店铺</th>
                  <th>语言</th>
                  <th>进度</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.name}>
                    <td>
                      <strong>{campaign.name}</strong>
                      <div className="muted">{campaign.source}</div>
                    </td>
                    <td>{campaign.store}</td>
                    <td>{campaign.locale}</td>
                    <td>
                      <ProgressBar value={campaign.progress} />
                    </td>
                    <td>
                      <Badge tone={campaign.status === "active" ? "good" : "neutral"}>{campaign.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="系统动态" description="最近生成、同步与发布事件。">
          <div className="list">
            {logs.map((log) => (
              <div className="list-item" key={`${log.time}-${log.message}`}>
                <div>
                  <strong>{log.message}</strong>
                  <small className="muted">
                    {log.time} · {log.module}
                  </small>
                </div>
                <Badge tone={log.level === "error" ? "danger" : log.level === "warning" ? "warn" : "good"}>
                  {log.status}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid--two" style={{ marginTop: 16 }}>
        <Panel title="重点店铺" description="优先关注授权、同步和内容覆盖情况。">
          <div className="table-wrap">
            <table>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.domain}>
                    <td>
                      <strong>{store.name}</strong>
                      <div className="muted code">{store.domain}</div>
                    </td>
                    <td>{store.locale}</td>
                    <td>
                      <Badge tone={store.status === "已连接" ? "good" : store.status === "同步中" ? "warn" : "danger"}>
                        {store.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="待处理文章" description="质量失败或待发布内容会优先展示。">
          <div className="list">
            {articles.map((article) => (
              <Link className="list-item" href="/articles" key={article.title}>
                <div>
                  <strong>{article.title}</strong>
                  <small className="muted">
                    {article.store} · SEO {article.seoScore}
                  </small>
                </div>
                <Badge tone={article.status === "ready_to_publish" ? "good" : "warn"}>{article.status}</Badge>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
