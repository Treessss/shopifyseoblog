import { FileText, RefreshCw } from "lucide-react";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { articles } from "@/lib/admin-data";

function articleTone(status: string) {
  if (status === "ready_to_publish" || status === "published") return "good";
  if (status === "quality_failed" || status === "failed") return "danger";
  return "neutral";
}

export default function ArticlesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Articles"
        title="文章管理"
        description="查看 AI 生成草稿、SEO 分数、质量门槛状态和 Shopify 发布结果。"
        action={
          <div className="toolbar">
            <button className="button">
              <RefreshCw size={16} aria-hidden="true" />
              重新评分
            </button>
            <button className="button button--primary">
              <FileText size={16} aria-hidden="true" />
              新建文章
            </button>
          </div>
        }
      />

      <Panel title="文章列表" description="质量达标的文章可以进入自动发布或人工复核流。">
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
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <tr key={article.title}>
                  <td>
                    <strong>{article.title}</strong>
                  </td>
                  <td>{article.store}</td>
                  <td>{article.locale}</td>
                  <td>{article.seoScore}</td>
                  <td>{article.updatedAt}</td>
                  <td>
                    <Badge tone={articleTone(article.status)}>{article.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
