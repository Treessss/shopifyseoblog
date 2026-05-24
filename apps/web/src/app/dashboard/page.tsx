import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleCheckBig,
  FileText,
  Layers3,
  Megaphone,
  PlayCircle,
  RefreshCw,
  Search,
  Store
} from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, StatusPill } from "@/components/ui";
import { StartPathPanel } from "@/components/start-path-panel";
import { getDashboardView } from "@/lib/admin-client";

export default async function DashboardPage() {
  const { data, error } = await getDashboardView();
  const healthyStores = data.stores.filter((store) => store.statusTone === "good").length;
  const activeCampaigns = data.campaigns.filter((campaign) => campaign.status === "active").length;
  const stalledCampaigns = data.campaigns.filter((campaign) => campaign.progressIsStale).length;
  const readyArticles = data.articles.filter((article) => article.status === "ready_to_publish").length;
  const primaryActionHref = healthyStores > 0 ? "/campaigns#new-campaign" : "/stores";
  const primaryActionLabel = healthyStores > 0 ? "开始新任务" : "先连接店铺";
  const queueHealthTone = data.queueHealth.tone;
  const queueHealthIcon =
    queueHealthTone === "danger" ? <AlertTriangle size={18} aria-hidden="true" /> : queueHealthTone === "good" ? <CircleCheckBig size={18} aria-hidden="true" /> : <PlayCircle size={18} aria-hidden="true" />;
  const failedJobContext = buildFailedJobContext(
    data.queueHealth.lastFailedJobType,
    data.queueHealth.lastFailedAt,
    data.queueHealth.lastFailedMessage
  );

  return (
    <>
      <PageHeader
        eyebrow="Start here"
        title="先从一个动作开始"
        description="这个控制台默认只给你一条最清晰的路：先确认店铺，再创建内容任务，最后看结果和复盘。"
        action={
          <div className="toolbar">
            <Link href={primaryActionHref} className="button button--primary">
              <PlayCircle size={16} aria-hidden="true" />
              {primaryActionLabel}
            </Link>
            <Link href="/agents" className="button">
              <Bot size={16} aria-hidden="true" />
              Agent 中心
            </Link>
            <Link href="/research" className="button">
              <Search size={16} aria-hidden="true" />
              看研究信号
            </Link>
            <Link href="/dashboard" className="button button--ghost" aria-label="刷新首页数据">
              <RefreshCw size={16} aria-hidden="true" />
            </Link>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="首页数据读取失败" />

        <StartPathPanel
          title="推荐路径"
          description="只保留最关键的三步，别让首页自己变成一个负担。"
          primaryLabel={primaryActionLabel}
          primaryHref={primaryActionHref}
          steps={[
            {
              index: "1",
              title: "确认店铺",
              detail: "没有连接时，先去店铺页。"
            },
            {
              index: "2",
              title: "创建内容任务",
              detail: "把主题、语言和发布策略一次选好。"
            },
            {
              index: "3",
              title: "查看结果",
              detail: "文章页看收录准备，复盘页看低 CTR 和下滑词。"
            }
          ]}
          statusLabel="当前起点"
          statusValue={healthyStores > 0 ? "可以建任务" : "先连店铺"}
          statusTone={healthyStores > 0 ? "good" : "warn"}
          statusHint="你现在应该优先做的只有一件事。首页负责告诉你下一步，Agent 中心负责告诉你卡在哪个智能体，文章页负责告诉你能不能发。"
          badgeLabel={data.queueHealth.label}
        />

        <div className="grid grid--metrics">
          <StatusPill
            label="健康店铺"
            value={`${healthyStores}/${data.stores.length}`}
            tone={healthyStores > 0 ? "good" : "neutral"}
            icon={<Store size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="进行中任务"
            value={activeCampaigns}
            tone={stalledCampaigns > 0 ? "danger" : activeCampaigns > 0 ? "warn" : "neutral"}
            icon={<Megaphone size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="待发布文章"
            value={readyArticles}
            tone={readyArticles > 0 ? "good" : "neutral"}
            icon={<FileText size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="处理方式"
            value="Agent 中心统筹"
            tone="neutral"
            icon={<Bot size={18} aria-hidden="true" />}
          />
        </div>

        <div className="grid grid--two">
          <Panel
            title="队列健康"
            description="让你知道现在是卡住、重试，还是已经可以继续往前。"
            action={
              <Link href="/logs" className="button button--ghost">
                <Activity size={16} aria-hidden="true" />
                看日志
              </Link>
            }
          >
            <div className="list">
              <div className="list-item">
                <div>
                  <strong>{data.queueHealth.queuedJobs} 个排队任务</strong>
                  <small className="muted">worker 正在按顺序取任务，不一定是坏掉。</small>
                </div>
                <Badge tone={data.queueHealth.queuedJobs > 0 ? "warn" : "good"}>{data.queueHealth.queuedJobs > 0 ? "排队中" : "空闲"}</Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>{data.queueHealth.runningJobs + data.queueHealth.retryingJobs} 个执行中任务</strong>
                  <small className="muted">
                    {stalledCampaigns > 0
                      ? `${stalledCampaigns} 个内容任务较久没有进度心跳，先去内容任务页处理。`
                      : "如果你刚点了生成、发布或修复，这里会先保持忙碌。"}
                  </small>
                </div>
                <Badge tone={stalledCampaigns > 0 ? "danger" : data.queueHealth.activeJobs > 0 ? "warn" : "neutral"}>
                  {stalledCampaigns > 0 ? "可能卡住" : data.queueHealth.activeJobs > 0 ? "处理中" : "空闲"}
                </Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>{data.queueHealth.failedJobs} 个失败任务</strong>
                  <small className="muted">
                    {failedJobContext ?? "如果这里不是 0，先看失败日志和文章状态。"}
                  </small>
                </div>
                <Badge tone={data.queueHealth.failedJobs > 0 ? "danger" : "good"}>{data.queueHealth.failedJobs > 0 ? "先处理" : "正常"}</Badge>
              </div>
            </div>
          </Panel>

          <Panel title="最近状态" description="只保留能判断当前是否可以继续的信号。">
            <div className="list">
              {data.logs.length === 0 ? (
                <EmptyState title="暂无系统状态" description="生成、同步和发布事件会显示在这里。" />
              ) : (
                data.logs.slice(0, 4).map((log) => (
                  <div className="list-item" key={log.id}>
                    <div>
                      <strong>{log.message}</strong>
                      <small className="muted">
                        {log.time} · {log.module}
                      </small>
                    </div>
                    <Badge tone={log.statusTone}>{log.status}</Badge>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>

        <Panel title="更多入口" description="这些入口还在，但不再抢主注意力。">
          <div className="compact-links">
            <Link href="/campaigns" className="compact-link">
              <Megaphone size={16} aria-hidden="true" />
              内容任务
            </Link>
            <Link href="/articles" className="compact-link">
              <FileText size={16} aria-hidden="true" />
              文章
            </Link>
            <Link href="/research" className="compact-link">
              <Search size={16} aria-hidden="true" />
              研究台
            </Link>
            <Link href="/priorities" className="compact-link">
              <Layers3 size={16} aria-hidden="true" />
              优先级板
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

function buildFailedJobContext(type: string | null, failedAt: string | null, message: string | null) {
  if (!type && !failedAt && !message) return null;
  const parts = [type ? `最后失败：${formatDashboardJobType(type)}` : "最后失败", failedAt ? formatDashboardDate(failedAt) : null].filter(Boolean);
  return `${parts.join(" · ")}${message ? `。${message}` : ""}`;
}

function formatDashboardJobType(type: string) {
  if (type === "generate_article") return "生成文章";
  if (type === "translate_article") return "翻译文章";
  if (type === "generate_asset") return "生成素材";
  if (type === "publish_article") return "发布文章";
  if (type === "sync_product") return "同步商品";
  if (type === "sync_collection") return "同步集合";
  if (type === "sync_search_console") return "同步 Search Console";
  return type;
}

function formatDashboardDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
