import Link from "next/link";
import { Activity, FileText, Languages, RefreshCw, Store } from "lucide-react";
import {
  Badge,
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  Panel,
  ProgressBar,
  StatusPill,
  TableEmpty
} from "@/components/ui";
import {
  formatArticleStatus,
  formatCampaignStatus,
  formatJobStatus,
  getDashboardView
} from "@/lib/admin-client";

export default async function DashboardPage() {
  const { data, error } = await getDashboardView();
  const healthyStores = data.stores.filter((store) => store.statusTone === "good").length;
  const runningCampaigns = data.campaigns.filter((campaign) => campaign.status === "active").length;
  const readyArticles = data.articles.filter((article) => article.status === "ready_to_publish").length;
  const enabledLocales = new Set([
    ...data.campaigns.map((campaign) => campaign.locale),
    ...data.articles.map((article) => article.locale),
    ...data.stores.map((store) => store.locale)
  ]).size;

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="内容增长仪表盘"
        description="集中查看多店铺内容生产、质量门槛、发布状态和近期异常，默认以简体中文呈现。"
        action={
          <Link href="/dashboard" className="button">
            <RefreshCw size={16} aria-hidden="true" />
            刷新数据
          </Link>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="仪表盘数据读取失败" />

        <div className="insight-strip">
          <StatusPill
            label="健康店铺"
            value={`${healthyStores}/${data.stores.length}`}
            tone={healthyStores > 0 ? "good" : "neutral"}
            icon={<Store size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="运行任务"
            value={runningCampaigns}
            tone={runningCampaigns > 0 ? "warn" : "neutral"}
            icon={<Activity size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="待发布"
            value={readyArticles}
            tone={readyArticles > 0 ? "good" : "neutral"}
            icon={<FileText size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="语言覆盖"
            value={enabledLocales || "zh-CN"}
            tone="neutral"
            icon={<Languages size={18} aria-hidden="true" />}
          />
        </div>

        <div className="grid grid--metrics">
          {data.metrics.map((item) => (
            <MetricCard key={item.label} {...item} />
          ))}
        </div>

        <div className="grid grid--two">
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
                  {data.campaigns.length === 0 ? (
                    <TableEmpty colSpan={5} title="暂无内容任务" description="创建任务后会在这里显示生成进度和发布策略。" />
                  ) : (
                    data.campaigns.slice(0, 6).map((campaign) => (
                      <tr key={campaign.id}>
                        <td>
                          <strong>{campaign.name}</strong>
                          <div className="muted">{campaign.source}</div>
                        </td>
                        <td>{campaign.store}</td>
                        <td className="code">{campaign.locale}</td>
                        <td>
                          <div className="progress-cell">
                            <ProgressBar value={campaign.progress} />
                            <span>{campaign.progress}%</span>
                          </div>
                        </td>
                        <td>
                          <Badge tone={campaign.statusTone}>{formatCampaignStatus(campaign.status)}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="系统动态"
            description="最近生成、同步与发布事件。"
            action={
              <Link href="/logs" className="button button--ghost">
                <Activity size={16} aria-hidden="true" />
                查看日志
              </Link>
            }
          >
            <div className="list">
              {data.logs.length === 0 ? (
                <EmptyState title="暂无系统动态" description="生成、同步和发布事件会进入日志接口。" />
              ) : (
                data.logs.slice(0, 5).map((log) => (
                  <div className="list-item" key={log.id}>
                    <div>
                      <strong>{log.message}</strong>
                      <small className="muted">
                        {log.time} · {log.module}
                      </small>
                    </div>
                    <Badge tone={log.statusTone}>{formatJobStatus(log.status)}</Badge>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>

        <div className="grid grid--two">
          <Panel
            title="重点店铺"
            description="优先关注授权、同步和内容覆盖情况。"
            action={
              <Link href="/stores" className="button button--ghost">
                <Store size={16} aria-hidden="true" />
                管理店铺
              </Link>
            }
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>店铺</th>
                    <th>语言</th>
                    <th>商品</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stores.length === 0 ? (
                    <TableEmpty colSpan={4} title="暂无店铺数据" description="连接 Shopify 店铺后会展示授权和同步状态。" />
                  ) : (
                    data.stores.slice(0, 6).map((store) => (
                      <tr key={store.id}>
                        <td>
                          <strong>{store.name}</strong>
                          <div className="muted code">{store.domain}</div>
                        </td>
                        <td className="code">{store.locale}</td>
                        <td>{store.products.toLocaleString("zh-CN")}</td>
                        <td>
                          <Badge tone={store.statusTone}>{store.status}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="待处理文章"
            description="质量失败或待发布内容会优先展示。"
            action={
              <Link href="/articles" className="button button--ghost">
                <FileText size={16} aria-hidden="true" />
                查看文章
              </Link>
            }
          >
            <div className="list">
              {data.articles.length === 0 ? (
                <EmptyState title="暂无文章数据" description="内容任务生成文章后会展示 SEO 分数和发布状态。" />
              ) : (
                data.articles.slice(0, 5).map((article) => (
                  <Link className="list-item" href="/articles" key={article.id}>
                    <div>
                      <strong>{article.title}</strong>
                      <small className="muted">
                        {article.store} · SEO {article.seoScore ?? "-"}
                      </small>
                    </div>
                    <Badge tone={article.statusTone}>{formatArticleStatus(article.status)}</Badge>
                  </Link>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
