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
  const aiSearchReview = asRecord(qualityReport.aiSearchReview ?? generationMetadata.aiSearchReview);
  const aiSearchInitial = asRecord(aiSearchReview.initial);
  const aiSearchFinal = asRecord(aiSearchReview.final);
  const aiSearchScore = numberValue(aiSearchFinal.score);
  const aiSearchRevisions = recordArray(aiSearchReview.revisions);
  const aiSearchActionItems = recordArray(aiSearchFinal.actionItems);
  const seoAgent = asRecord(generationMetadata.seoAgent);
  const agentStages = recordArray(seoAgent.stages);
  const agentToolCalls = recordArray(seoAgent.toolCalls);
  const agentReflectionTasks = recordArray(seoAgent.reflectionTasks);
  const agentMemory = asRecord(seoAgent.memory);
  const structuredAgentTrace = asRecord(generationMetadata.structuredAgentTrace);
  const agentSteps = recordArray(structuredAgentTrace.steps);
  const visibleAgentToolCalls = recordArray(structuredAgentTrace.toolCalls).length
    ? recordArray(structuredAgentTrace.toolCalls)
    : agentToolCalls;
  const visibleReflectionTasks = recordArray(structuredAgentTrace.reflectionTasks).length
    ? recordArray(structuredAgentTrace.reflectionTasks)
    : agentReflectionTasks;
  const structuredStepCount = numberValue(structuredAgentTrace.stepCount);
  const executionStepCount =
    structuredStepCount && structuredStepCount > 0
      ? structuredStepCount
      : agentSteps.length || agentStages.length || visibleAgentToolCalls.length + visibleReflectionTasks.length;
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
                label={aiSearchScore !== null ? "AI 搜索分" : "SEO 分"}
                value={aiSearchScore ?? article.seoScore ?? "暂无"}
                tone={(aiSearchScore ?? article.seoScore ?? 0) >= 82 ? "good" : "warn"}
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

                <Panel title="AI 搜索流量评审" compact>
                  {Object.keys(aiSearchReview).length > 0 ? (
                    <div className="stack">
                      <dl className="detail-list">
                        <div>
                          <dt>最终搜索分</dt>
                          <dd>{aiSearchScore ?? "暂无"}</dd>
                        </div>
                        <div>
                          <dt>初评分</dt>
                          <dd>{numberValue(aiSearchInitial.score) ?? "暂无"}</dd>
                        </div>
                        <div>
                          <dt>最低要求</dt>
                          <dd>{numberValue(aiSearchReview.minTrafficScore) ?? 82}</dd>
                        </div>
                        <div>
                          <dt>自动改稿</dt>
                          <dd>{aiSearchRevisions.length} 次</dd>
                        </div>
                      </dl>
                      <ScoreGrid review={aiSearchFinal} />
                      <TextList title="AI 判断" items={[stringValue(aiSearchFinal.summary)].filter(Boolean) as string[]} />
                      <ActionItemList title="最终待优化点" items={aiSearchActionItems} />
                      <TextList title="提升建议" items={stringArray(aiSearchFinal.recommendations)} />
                      <TextList title="改稿指令" items={stringArray(aiSearchFinal.revisionBrief)} />
                      {aiSearchRevisions.length > 0 ? (
                        <div className="json-block">
                          {aiSearchRevisions.map((revision, index) => (
                            <div key={index} className="stack">
                              <strong>
                                第 {numberValue(revision.pass) ?? index + 1} 次：{numberValue(revision.beforeScore) ?? "-"} →{" "}
                                {numberValue(revision.afterScore) ?? "-"}
                              </strong>
                              <TextList title="本轮修改依据" items={stringArray(revision.recommendations)} />
                              <TextList title="本轮改稿变化" items={stringArray(revision.changes)} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <EmptyState title="暂无 AI 搜索评审" description="开启 AI 搜索评分后，生成完成会显示评分、建议和改稿记录。" />
                  )}
                </Panel>

                <Panel title="质检报告" compact>
                  <JsonBlock value={qualityReport} empty="暂无质检报告" />
                </Panel>

                <Panel title="AI Agent 轨迹" compact>
                  {agentSteps.length > 0 || agentStages.length > 0 || visibleAgentToolCalls.length > 0 || visibleReflectionTasks.length > 0 ? (
                    <div className="stack">
                      <dl className="detail-list">
                        <div>
                          <dt>Agent 版本</dt>
                          <dd className="code">
                            {stringValue(structuredAgentTrace.agentVersion) ?? stringValue(seoAgent.agentVersion) ?? "未记录"}
                          </dd>
                        </div>
                        <div>
                          <dt>运行状态</dt>
                          <dd>{stringValue(structuredAgentTrace.status) ?? stringValue(seoAgent.status) ?? "未记录"}</dd>
                        </div>
                        <div>
                          <dt>执行步骤</dt>
                          <dd>{executionStepCount}</dd>
                        </div>
                        <div>
                          <dt>工具 / 反思</dt>
                          <dd>
                            {numberValue(structuredAgentTrace.toolCallCount) ?? visibleAgentToolCalls.length} /{" "}
                            {numberValue(structuredAgentTrace.reflectionTaskCount) ?? visibleReflectionTasks.length}
                          </dd>
                        </div>
                      </dl>
                      {agentSteps.length > 0 ? (
                        <AgentStepTimeline steps={agentSteps} />
                      ) : agentStages.length > 0 ? (
                        <AgentTimeline stages={agentStages} />
                      ) : (
                        <AgentToolCallTimeline calls={visibleAgentToolCalls} />
                      )}
                      <TextList
                        title="记忆规则"
                        items={stringArray(agentMemory.learnedRules).concat(
                          stringArray(agentMemory.blockedAngles).map((angle) => `避开角度：${angle}`)
                        )}
                      />
                      <ActionItemList title="Agent 反思任务" items={visibleReflectionTasks} />
                      <JsonBlock
                        value={{
                          toolCalls: visibleAgentToolCalls.slice(0, 8),
                          memory: agentMemory,
                          evidence: recordArray(structuredAgentTrace.evidence).slice(0, 8)
                        }}
                        empty="暂无 Agent 运行数据"
                      />
                    </div>
                  ) : (
                    <EmptyState title="暂无 Agent 轨迹" description="商业级 SEO Agent 运行后会展示阶段、工具、反思任务和记忆命中。" />
                  )}
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

function ScoreGrid({ review }: { review: Record<string, unknown> }) {
  const scores = [
    ["搜索意图", review.searchIntentScore],
    ["标题点击", review.titleCtrScore],
    ["内容深度", review.contentDepthScore],
    ["关键词匹配", review.keywordFitScore],
    ["主题权威", review.topicalAuthorityScore],
    ["转化支持", review.conversionSupportScore]
  ]
    .map(([label, value]) => ({ label: String(label), value: numberValue(value) }))
    .filter((item) => item.value !== null);

  if (scores.length === 0) return null;

  return (
    <dl className="detail-list">
      {scores.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <strong>{title}</strong>
      <div className="json-block">
        {items.map((item) => (
          <div key={item}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentTimeline({ stages }: { stages: Array<Record<string, unknown>> }) {
  return (
    <div className="json-block">
      {stages.map((stage, index) => {
        const name = stringValue(stage.stage) ?? `stage-${index + 1}`;
        const role = stringValue(stage.agentRole) ?? "agent";
        const status = stringValue(stage.status) ?? "unknown";
        const decision = stringValue(stage.decision);

        return (
          <div key={`${name}-${index}`} className="stack">
            <strong>
              {index + 1}. {name} · {role} · {status}
            </strong>
            {decision ? <div>{decision}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function AgentStepTimeline({ steps }: { steps: Array<Record<string, unknown>> }) {
  return (
    <div className="json-block">
      {steps.map((step, index) => {
        const sequence = numberValue(step.sequence) ?? index + 1;
        const title = stringValue(step.title) ?? stringValue(step.key) ?? `step-${sequence}`;
        const status = stringValue(step.status) ?? "unknown";
        const type = stringValue(step.type) ?? "step";
        const summary = stringValue(step.summary) ?? stringValue(step.decision);
        const warnings = stringArray(step.warnings);

        return (
          <div key={`${sequence}-${title}`} className="stack">
            <strong>
              {sequence}. {title} · {type} · {status}
            </strong>
            {summary ? <div>{summary}</div> : null}
            {warnings.length > 0 ? <TextList title="警告" items={warnings.slice(0, 3)} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function AgentToolCallTimeline({ calls }: { calls: Array<Record<string, unknown>> }) {
  return (
    <div className="json-block">
      {calls.map((call, index) => {
        const toolName = stringValue(call.toolName) ?? stringValue(call.tool) ?? `tool-${index + 1}`;
        const status = stringValue(call.status) ?? "unknown";
        const stage = stringValue(call.stage) ?? "tool";
        const role = stringValue(call.agentRole);
        const warnings = stringArray(call.warnings);

        return (
          <div key={`${toolName}-${index}`} className="stack">
            <strong>
              {index + 1}. 工具调用 · {toolName} · {stage} · {status}
            </strong>
            {role ? <div>负责 Agent：{role}</div> : null}
            {warnings.length > 0 ? <TextList title="警告" items={warnings.slice(0, 3)} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function ActionItemList({ title, items }: { title: string; items: Array<Record<string, unknown>> }) {
  if (items.length === 0) return null;

  return (
    <div>
      <strong>{title}</strong>
      <div className="json-block">
        {items.map((item, index) => {
          const priority = stringValue(item.priority) ?? "high";
          const area = stringValue(item.area) ?? stringValue(item.agentRole) ?? "文章";
          const issue = stringValue(item.issue) ?? stringValue(item.status) ?? "待处理";
          const concreteEdit = stringValue(item.concreteEdit) ?? stringValue(item.instruction) ?? "暂无具体改法";
          const acceptanceCheck = stringValue(item.acceptanceCheck) ?? "确认修改已经落地。";

          return (
            <div key={`${area}-${index}`} className="stack">
              <strong>
                {index + 1}. [{priority}] {area}
              </strong>
              <div>问题：{issue}</div>
              <div>改法：{concreteEdit}</div>
              <div>验收：{acceptanceCheck}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}
