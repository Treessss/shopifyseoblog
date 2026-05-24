import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Globe2, ListTodo, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, ErrorState, PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardView, getSearchConsoleView } from "@/lib/admin-client";

export default async function ContentRulesPage() {
  const [dashboard, searchConsole] = await Promise.all([getDashboardView(), getSearchConsoleView()]);
  const healthyStores = dashboard.data.stores.filter((store) => store.statusTone === "good").length;
  const readyArticles = dashboard.data.articles.filter((article) => article.status === "ready_to_publish");
  const publishedArticles = dashboard.data.articles.filter((article) => article.status === "published");
  const articlesWithCanonical = dashboard.data.articles.filter((article) => Boolean(article.canonicalUrl));
  const connectedProperties = searchConsole.data.properties.filter((property) => property.status === "active");
  const activeSnapshots = searchConsole.data.snapshots.length;

  return (
    <>
      <PageHeader
        eyebrow="Guidelines"
        title="内容准则"
        description="把 publish-ready、index-ready 和 rank-ready 分开讲清楚，避免把“已生成”误当成“可排名”。"
        action={
          <div className="toolbar">
            <Link href="/campaigns" className="button">
              <ListTodo size={16} aria-hidden="true" />
              去任务
            </Link>
            <Link href="/articles" className="button button--primary">
              <FileText size={16} aria-hidden="true" />
              去文章
            </Link>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={dashboard.error} title="内容准则数据读取失败" />
        <ErrorState error={searchConsole.error} title="Search Console 数据读取失败" />

        <div className="insight-strip">
          <StatusPill label="健康店铺" value={healthyStores} tone={healthyStores > 0 ? "good" : "warn"} icon={<CheckCircle2 size={18} aria-hidden="true" />} />
          <StatusPill label="可发布文章" value={readyArticles.length} tone={readyArticles.length > 0 ? "good" : "neutral"} icon={<Sparkles size={18} aria-hidden="true" />} />
          <StatusPill label="已上线文章" value={publishedArticles.length} tone={publishedArticles.length > 0 ? "good" : "neutral"} icon={<ShieldCheck size={18} aria-hidden="true" />} />
          <StatusPill label="canonical 页面" value={articlesWithCanonical.length} tone={articlesWithCanonical.length > 0 ? "good" : "neutral"} icon={<Globe2 size={18} aria-hidden="true" />} />
        </div>

        <div className="grid grid--two">
          <Panel title="三个判断标准" description="系统会按这三层来判断文章现在到底走到哪一步。">
            <div className="list">
              <div className="list-item">
                <div>
                  <strong>Publish-ready</strong>
                  <small className="muted">质量门禁、标题、摘要、结构、内链、外链、FAQ 和 humanizer 全部过线，才算可以发布。</small>
                </div>
                <Badge tone="warn">发前检查</Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>Index-ready</strong>
                  <small className="muted">文章已经发布并有 canonical URL，Google 才有可抓取页面。</small>
                </div>
                <Badge tone="good">可收录</Badge>
              </div>
              <div className="list-item">
                <div>
                  <strong>Rank-ready</strong>
                  <small className="muted">必须再看 Search Console 的曝光、CTR、平均排名和 query gap，不能只靠生成结果断言。</small>
                </div>
                <Badge tone="neutral">需验证</Badge>
              </div>
            </div>
          </Panel>

          <Panel title="从哪里开始" description="新用户先看这里就够了。">
            <div className="list">
              <div className="list-item">
                <div>
                  <strong>1. 连店铺</strong>
                  <small className="muted">没有店铺，Agent 没法读取商品、集合和发布目标。</small>
                </div>
                <Link href="/stores" className="button button--small">
                  打开
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
              <div className="list-item">
                <div>
                  <strong>2. 建任务</strong>
                  <small className="muted">从主题、关键词和发布策略开始，其他高级选项后补。</small>
                </div>
                <Link href="/campaigns#new-campaign" className="button button--small">
                  开始
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
              <div className="list-item">
                <div>
                  <strong>3. 看文章与修复</strong>
                  <small className="muted">文章页看质量门禁，任务页看卡点和恢复路径。</small>
                </div>
                <Link href="/articles" className="button button--small">
                  审核
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="当前数据快照" description="用你现有的两家店铺数据来判断当前系统状态，不做空泛描述。">
          <div className="insight-strip">
            <StatusPill label="Search Console 属性" value={connectedProperties.length} tone={connectedProperties.length > 0 ? "good" : "warn"} icon={<Search size={18} aria-hidden="true" />} />
            <StatusPill label="GSC 快照" value={activeSnapshots} tone={activeSnapshots > 0 ? "good" : "neutral"} icon={<Globe2 size={18} aria-hidden="true" />} />
            <StatusPill label="已发布文章" value={publishedArticles.length} tone={publishedArticles.length > 0 ? "good" : "neutral"} icon={<ShieldCheck size={18} aria-hidden="true" />} />
            <StatusPill label="待发布文章" value={readyArticles.length} tone={readyArticles.length > 0 ? "warn" : "neutral"} icon={<Sparkles size={18} aria-hidden="true" />} />
          </div>
        </Panel>
      </div>
    </>
  );
}
