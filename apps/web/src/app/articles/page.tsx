import { FileText, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { Badge, ErrorState, PageHeader, Panel, TableEmpty } from "@/components/ui";
import { formatArticleStatus, getArticlesView } from "@/lib/admin-client";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function param(params: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function ArticlesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = param(params, "q").trim().toLowerCase();
  const status = param(params, "status");
  const articlesResult = await getArticlesView();
  const articles = articlesResult.data;
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
        description="查看 AI 生成草稿、SEO 分数、质量门槛状态和 Shopify 发布结果。"
        action={
          <div className="toolbar">
            <Link href="/articles" className="button">
              <RefreshCw size={16} aria-hidden="true" />
              刷新
            </Link>
            <Link href="/campaigns#new-campaign" className="button button--primary">
              <FileText size={16} aria-hidden="true" />
              新建任务生成
            </Link>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={articlesResult.error} title="文章数据读取失败" />

        <Panel title="文章列表" description="质量达标的文章可以进入自动发布或人工复核流。">
          <form className="filter-bar" action="/articles">
            <label className="filter-field">
              <Search size={15} aria-hidden="true" />
              <input name="q" defaultValue={param(params, "q")} placeholder="搜索文章、店铺或语言" />
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
                        <form action={`/api/admin/articles/${article.id}/publish`} method="post">
                          <button className="button button--small" type="submit" disabled={article.status !== "ready_to_publish"}>
                            发布
                          </button>
                        </form>
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
