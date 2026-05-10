import {
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  FileText,
  Gauge,
  Image as ImageIcon,
  Link as LinkIcon,
  Send,
  ShieldCheck,
  Tags
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, StatusPill } from "@/components/ui";
import { formatArticleStatus, getArticleReviewView } from "@/lib/admin-client";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ArticleReviewPage({ params }: PageProps) {
  const { id } = await params;
  const articleResult = await getArticleReviewView(id);
  const article = articleResult.data;

  if (!article && !articleResult.error) notFound();

  const sanitizedBody = sanitizeArticleHtml(article?.bodyHtml ?? "");
  const canPublish = article?.status === "ready_to_publish";
  const qualityReport = asRecord(article?.qualityReport);
  const generationMetadata = asRecord(article?.generationMetadata);
  const generationQuality = asRecord(generationMetadata.quality);
  const provider = asRecord(generationMetadata.provider);
  const ai = asRecord(generationMetadata.ai);
  const topicSelection = generationMetadata.topicSelection;
  const keywordEvidence = generationMetadata.keywordEvidence;
  const evidenceSummary =
    topicSelection || (Array.isArray(keywordEvidence) && keywordEvidence.length > 0)
      ? {
          topicSelection,
          keywordEvidence
        }
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Review"
        title={article?.title ?? "文章审核"}
        description="完整预览生成内容、关键词、SEO 与质量门禁结果，确认后再发布到 Shopify。"
        action={
          <div className="toolbar">
            <Link href="/articles" className="button">
              <ArrowLeft size={16} aria-hidden="true" />
              返回文章
            </Link>
            {article?.canonicalUrl ? (
              <a className="button" href={article.canonicalUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} aria-hidden="true" />
                查看线上
              </a>
            ) : null}
            {article ? (
              <form action={`/api/admin/articles/${article.id}/publish`} method="post">
                <button className="button button--primary" type="submit" disabled={!canPublish}>
                  <Send size={16} aria-hidden="true" />
                  发布
                </button>
              </form>
            ) : null}
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={articleResult.error} title="文章详情读取失败" />

        {article ? (
          <>
            <div className="insight-strip">
              <StatusPill
                label="文章状态"
                value={formatArticleStatus(article.status)}
                tone={article.statusTone}
                icon={<FileText size={18} aria-hidden="true" />}
              />
              <StatusPill
                label="SEO 分"
                value={article.seoScore ?? "暂无"}
                tone={(article.seoScore ?? 0) >= 78 ? "good" : "warn"}
                icon={<Gauge size={18} aria-hidden="true" />}
              />
              <StatusPill
                label="质量门禁"
                value={article.qualityPassed ? "通过" : "未通过"}
                tone={article.qualityPassed ? "good" : "danger"}
                icon={<ShieldCheck size={18} aria-hidden="true" />}
              />
              <StatusPill
                label="发布策略"
                value={article.publishPolicy ?? "未配置"}
                tone={canPublish ? "good" : "neutral"}
                icon={<CalendarClock size={18} aria-hidden="true" />}
              />
            </div>

            <section className="review-layout">
              <div className="stack">
                <Panel
                  title="完整正文预览"
                  description="这里展示将用于 Shopify 发布审核的完整文章内容。"
                  action={<Badge tone={article.statusTone}>{formatArticleStatus(article.status)}</Badge>}
                >
                  <article className="article-preview">
                    {article.summary ? <p className="article-preview__summary">{article.summary}</p> : null}
                    {sanitizedBody ? (
                      <div className="article-prose" dangerouslySetInnerHTML={{ __html: sanitizedBody }} />
                    ) : (
                      <EmptyState title="正文为空" description="这篇文章还没有生成正文 HTML。" />
                    )}
                  </article>
                </Panel>

                <Panel title="素材与插图" description="自动生成或同步的文章图片素材。">
                  {article.assets.length > 0 ? (
                    <div className="asset-grid">
                      {article.assets.map((asset) => {
                        const url = asset.publicUrl ?? asset.sourceUrl;
                        return (
                          <article className="asset-card" key={asset.id}>
                            {url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={url} alt={asset.altText ?? "文章图片"} />
                            ) : (
                              <div className="asset-card__empty">
                                <ImageIcon size={22} aria-hidden="true" />
                              </div>
                            )}
                            <div>
                              <strong>{asset.altText ?? asset.type}</strong>
                              {asset.prompt ? <p>{asset.prompt}</p> : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState title="暂无素材" description="这篇文章还没有生成图片素材记录。" />
                  )}
                </Panel>
              </div>

              <aside className="review-sidebar">
                <Panel title="审核信息" compact>
                  <dl className="detail-list">
                    <div>
                      <dt>店铺</dt>
                      <dd>{article.store}</dd>
                    </div>
                    <div>
                      <dt>语言</dt>
                      <dd className="code">{article.locale}</dd>
                    </div>
                    <div>
                      <dt>任务</dt>
                      <dd>{article.campaign ?? "未绑定任务"}</dd>
                    </div>
                    <div>
                      <dt>Handle</dt>
                      <dd className="code">{article.handle ?? "未生成"}</dd>
                    </div>
                    <div>
                      <dt>更新时间</dt>
                      <dd>{article.updatedAt}</dd>
                    </div>
                  </dl>
                </Panel>

                <Panel title="关键词布局" compact>
                  <div className="keyword-stack">
                    {article.primaryKeyword ? (
                      <span className="keyword-chip keyword-chip--primary">
                        <Tags size={14} aria-hidden="true" />
                        {article.primaryKeyword}
                      </span>
                    ) : null}
                    {article.secondaryKeywords.map((keyword) => (
                      <span className="keyword-chip" key={keyword}>
                        {keyword}
                      </span>
                    ))}
                    {article.tags.map((tag) => (
                      <span className="keyword-chip keyword-chip--muted" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </Panel>

                <Panel title="选题与关键词依据" compact>
                  <JsonBlock value={evidenceSummary} empty="暂无关键词依据" />
                </Panel>

                <Panel title="SEO 摘要" compact>
                  <dl className="detail-list">
                    <div>
                      <dt>SEO 标题</dt>
                      <dd>{article.seoTitle ?? article.title}</dd>
                    </div>
                    <div>
                      <dt>SEO 描述</dt>
                      <dd>{article.seoDescription ?? article.summary ?? "暂无"}</dd>
                    </div>
                    <div>
                      <dt>Canonical</dt>
                      <dd>
                        {article.canonicalUrl ? (
                          <a className="text-link" href={article.canonicalUrl} target="_blank" rel="noreferrer">
                            <LinkIcon size={14} aria-hidden="true" />
                            打开链接
                          </a>
                        ) : (
                          "未发布"
                        )}
                      </dd>
                    </div>
                  </dl>
                </Panel>

                <Panel title="质检报告" compact>
                  <JsonBlock value={qualityReport} empty="暂无质检报告" />
                </Panel>

                <Panel title="生成信息" compact>
                  <dl className="detail-list">
                    <div>
                      <dt>Provider</dt>
                      <dd>{stringValue(provider.name) ?? "未记录"}</dd>
                    </div>
                    <div>
                      <dt>文本模型</dt>
                      <dd className="code">{stringValue(provider.textModel) ?? stringValue(ai.model) ?? "未记录"}</dd>
                    </div>
                    <div>
                      <dt>图片模型</dt>
                      <dd className="code">{stringValue(provider.imageModel) ?? "未配置"}</dd>
                    </div>
                    <div>
                      <dt>最终字数</dt>
                      <dd>{numberValue(generationQuality.wordCount) ?? numberValue(qualityReport.wordCount) ?? "暂无"}</dd>
                    </div>
                  </dl>
                </Panel>
              </aside>
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}

function JsonBlock(props: { value: unknown; empty: string }) {
  if (!props.value || (typeof props.value === "object" && Object.keys(props.value).length === 0)) {
    return <EmptyState title={props.empty} description="生成完成后会在这里显示结构化审核信息。" />;
  }

  return <pre className="json-block">{JSON.stringify(props.value, null, 2)}</pre>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
