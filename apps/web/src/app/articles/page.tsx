import { CheckCircle2, Eye, FileText, Gauge, ListFilter, Megaphone, RefreshCw, Search, Send } from "lucide-react";
import Link from "next/link";
import { Badge, ErrorState, FormNotice, PageHeader, Panel, StatusPill, TableEmpty } from "@/components/ui";
import { formatArticleStatus, getArticlesView } from "@/lib/admin-client";
import { readFormNotice, readSearchParam } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ArticlesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = readSearchParam(params, "q").trim().toLowerCase();
  const status = readSearchParam(params, "status");
  const articlesResult = await getArticlesView();
  const articles = articlesResult.data;
  const notice = readFormNotice(params);
  const draftCount = articles.filter((article) => article.status === "draft").length;
  const qualityFailedCount = articles.filter((article) => article.status === "quality_failed").length;
  const readyCount = articles.filter((article) => article.status === "ready_to_publish").length;
  const publishedCount = articles.filter((article) => article.status === "published").length;
  const filteredArticles = articles.filter((article) => {
    const matchesQuery = !query || `${article.title} ${article.store} ${article.locale}`.toLowerCase().includes(query);
    const matchesStatus = !status || article.status === status;
    return matchesQuery && matchesStatus;
  });

  return (
    <>
      <PageHeader
        eyebrow="Articles"
        title="文章管理"
        description="查看草稿、SEO 分数、质检状态和发布记录。"
        action={
          <div className="toolbar">
            <Link href="/articles" className="button">
              <RefreshCw size={16} aria-hidden="true" />
              刷新
            </Link>
            <Link href="/campaigns#new-campaign" className="button button--primary">
              <Megaphone size={16} aria-hidden="true" />
              新建内容任务
            </Link>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={articlesResult.error} title="文章数据读取失败" />
        {notice ? <FormNotice {...notice} /> : null}

        <div className="insight-strip">
          <StatusPill
            label="平均 SEO"
            value={
              articles.length
                ? Math.round(articles.reduce((sum, article) => sum + (article.seoScore ?? 0), 0) / articles.length)
                : "暂无"
            }
            tone="neutral"
            icon={<Gauge size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="可发布"
            value={readyCount}
            tone={readyCount > 0 ? "good" : "neutral"}
            icon={<Send size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="已发布"
            value={publishedCount}
            tone="good"
            icon={<CheckCircle2 size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="需处理"
            value={qualityFailedCount}
            tone={qualityFailedCount > 0 ? "danger" : "good"}
            icon={<FileText size={18} aria-hidden="true" />}
          />
        </div>

        <Panel title="文章列表" description="质量达标的文章可以进入自动发布或人工复核流。">
          <div className="workflow-rail" aria-label="文章生产流程">
            <div className="workflow-step">
              <span>草稿</span>
              <strong>{draftCount}</strong>
            </div>
            <div className="workflow-step">
              <span>质检失败</span>
              <strong>{qualityFailedCount}</strong>
            </div>
            <div className="workflow-step">
              <span>待发布</span>
              <strong>{readyCount}</strong>
            </div>
            <div className="workflow-step">
              <span>已发布</span>
              <strong>{publishedCount}</strong>
            </div>
          </div>
          <form className="filter-bar" action="/articles">
            <label className="filter-field">
              <Search size={15} aria-hidden="true" />
              <input name="q" defaultValue={readSearchParam(params, "q")} placeholder="搜索文章、店铺或语言" />
            </label>
            <label className="filter-select">
              <span>状态</span>
              <select name="status" defaultValue={status}>
                <option value="">全部</option>
                {[...new Set(articles.map((article) => article.status))].map((item) => (
                  <option key={item} value={item}>
                    {formatArticleStatus(item)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button" type="submit">
              <ListFilter size={16} aria-hidden="true" />
              筛选
            </button>
            <span className="filter-bar__summary">当前 {filteredArticles.length} 篇文章</span>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>文章</th>
                  <th>店铺</th>
                  <th>语言</th>
                  <th>SEO 分数</th>
                  <th>更新时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredArticles.length === 0 ? (
                  <TableEmpty
                    colSpan={7}
                    title={articles.length === 0 ? "暂无文章" : "没有匹配的文章"}
                    description={
                      articles.length === 0
                        ? "生成任务产出草稿后，此处会展示 SEO 分数、质量状态和发布结果。"
                        : "调整搜索关键词或状态筛选条件。"
                    }
                  />
                ) : (
                  filteredArticles.map((article) => (
                    <tr key={article.id}>
                      <td>
                        <strong>{article.title}</strong>
                        {article.failureReason ? <div className="danger-text">{article.failureReason}</div> : null}
                      </td>
                      <td>{article.store}</td>
                      <td className="code">{article.locale}</td>
                      <td>{article.seoScore ?? "暂无"}</td>
                      <td>{article.updatedAt}</td>
                      <td>
                        <Badge tone={article.statusTone}>{formatArticleStatus(article.status)}</Badge>
                      </td>
                      <td>
                        <div className="row-actions">
                          <Link className="button button--small" href={`/articles/${article.id}`}>
                            <Eye size={14} aria-hidden="true" />
                            审核
                          </Link>
                          <form action={`/api/admin/articles/${article.id}/publish`} method="post">
                            <button className="button button--small" type="submit" disabled={article.status !== "ready_to_publish"}>
                              <Send size={14} aria-hidden="true" />
                              发布
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
