import {
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  FileText,
  Gauge,
  Image as ImageIcon,
  ListChecks,
  Link as LinkIcon,
  ScanSearch,
  Sparkles,
  Search,
  Send,
  ShieldCheck,
  Tags
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, StatusPill } from "@/components/ui";
import { ArticleAgentCenter } from "@/components/article-agent-center";
import {
  createPythonQualityGate,
  createPythonRepairPlan,
  type PythonQualityGate,
  type PythonQualityGateCheck,
  type PythonQualityGateRequest,
  type PythonRepairPlan,
  type PythonRepairPlanTask
} from "@/lib/agent-center/python-agent-client";
import { formatArticleStatus, getArticleReviewView } from "@/lib/admin-client";
import type { AdminArticleReviewView } from "@/lib/admin-client";
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
  const canSyncSearchConsole = Boolean(article?.canonicalUrl);
  const qualityGateReady = Boolean(article?.qualityPassed);
  const qualityReport = asRecord(article?.qualityReport);
  const generationMetadata = asRecord(article?.generationMetadata);
  const generationQuality = asRecord(generationMetadata.quality);
  const aiSearchReview = asRecord(qualityReport.aiSearchReview ?? generationMetadata.aiSearchReview);
  const aiSearchInitial = asRecord(aiSearchReview.initial);
  const aiSearchFinal = asRecord(aiSearchReview.final);
  const aiSearchScore = numberValue(aiSearchFinal.score);
  const aiSearchRevisions = recordArray(aiSearchReview.revisions);
  const aiSearchActionItems = recordArray(aiSearchFinal.actionItems);
  const seoAgent = asRecord(generationMetadata.seoAgent);
  const brandVoice = asRecord(generationMetadata.brandVoice);
  const brandVoiceExamples = stringArray(brandVoice.examples);
  const brandVoiceBannedWords = stringArray(brandVoice.bannedWords);
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
  const trendSignals = generationMetadata.trendSignals;
  const entityInsights = generationMetadata.entityInsights;
  const externalReferences = generationMetadata.externalReferences;
  const marketInsights = generationMetadata.marketInsights;
  const competitorAngles = generationMetadata.competitorAngles;
  const sourceSummary = generationMetadata.sourceSummary;
  const contentBrief = asRecord(generationMetadata.contentBrief);
  const articleImageAltTexts = article?.assets.map((asset) => asset.altText).filter((value): value is string => Boolean(value?.trim())) ?? [];
  const pythonQualityRequest: PythonQualityGateRequest = {
    title: article?.title ?? "",
    body_html: article?.bodyHtml ?? "",
    summary: article?.summary ?? null,
    primary_keyword: article?.primaryKeyword ?? null,
    seo_title: article?.seoTitle ?? null,
    seo_description: article?.seoDescription ?? null,
    seo_score: article?.seoScore ?? null,
    ai_search_score: aiSearchScore,
    editorial_score: numberValue(generationQuality.editorialScore),
    expert_panel_score: numberValue(generationQuality.expertPanelScore),
    has_canonical_url: Boolean(article?.canonicalUrl),
    has_internal_links: Boolean(recordArray(qualityReport.internalLinks).length || article?.bodyHtml?.includes("<a ")),
    has_external_references: Boolean(recordArray(externalReferences).length),
    has_faq: Boolean(recordArray(contentBrief.faqs).length || recordArray(contentBrief.faq).length || article?.bodyHtml?.includes("<h3")),
    has_decision_support: Boolean(recordArray(contentBrief.decisionSupport).length || recordArray(contentBrief.comparisonMatrix).length),
    has_images: Boolean(article?.assets.length),
    image_alt_texts: articleImageAltTexts,
    quality_passed: Boolean(article?.qualityPassed),
    brand_voice_banned_words: stringArray(brandVoice.bannedWords)
  };
  const evidenceSummary =
    topicSelection ||
    (Array.isArray(keywordEvidence) && keywordEvidence.length > 0) ||
    (Array.isArray(trendSignals) && trendSignals.length > 0) ||
    (Array.isArray(entityInsights) && entityInsights.length > 0) ||
    (Array.isArray(externalReferences) && externalReferences.length > 0) ||
    (Array.isArray(marketInsights) && marketInsights.length > 0) ||
    (Array.isArray(competitorAngles) && competitorAngles.length > 0)
      ? {
          topicSelection,
          keywordEvidence,
          trendSignals,
          entityInsights,
          externalReferences,
          marketInsights,
          competitorAngles,
          sourceSummary,
          contentBrief
        }
      : null;
  const [pythonQualityGate, pythonRepairPlan] = await Promise.all([
    createPythonQualityGate(pythonQualityRequest),
    article
      ? createPythonRepairPlan({
          ...pythonQualityRequest,
          article_id: article.id,
          canonical_url: article.canonicalUrl,
          status: article.status,
          repair_reason: "按质量门禁、Humanizer、Helpful Content 和收录准备生成可执行修复计划。"
        })
      : null
  ]);
  const qualityGateSummary =
    pythonQualityGate ??
    buildLocalQualityGateSummary({
      article,
      aiSearchScore,
      editorialScore: numberValue(generationQuality.editorialScore),
      expertPanelScore: numberValue(generationQuality.expertPanelScore),
      hasExternalReferences: Boolean(recordArray(externalReferences).length),
      hasFaq: Boolean(recordArray(contentBrief.faqs).length || recordArray(contentBrief.faq).length || article?.bodyHtml?.includes("<h3")),
      hasDecisionSupport: Boolean(recordArray(contentBrief.decisionSupport).length || recordArray(contentBrief.comparisonMatrix).length),
      imageAltTexts: articleImageAltTexts
    });
  const repairPlan = pythonRepairPlan ?? buildLocalRepairPlan(article, qualityGateSummary);
  const structureChecks = qualityGateSummary.checks.filter((check) =>
    ["title_intent", "summary_meta", "heading_structure", "faq", "image_alt", "internal_links", "external_references"].includes(check.key)
  );
  const readinessHeadline = resolveReadinessHeadline(article, qualityGateSummary);

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
              <form action={`/api/admin/articles/${article.id}/repair`} method="post">
                <input type="hidden" name="repairReason" value="从文章审核页触发：按 Search Console、AI 搜索评分和质检报告修复正文。" />
                <button className="button" type="submit">
                  <Sparkles size={16} aria-hidden="true" />
                  AI 修复
                </button>
              </form>
            ) : null}
            {article ? (
              <form action={`/api/admin/articles/${article.id}/search-console`} method="post">
                <button className="button" type="submit" disabled={!canSyncSearchConsole}>
                  <Search size={16} aria-hidden="true" />
                  同步搜索表现
                </button>
              </form>
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
              <StatusPill
                label="收录准备"
                value={`${article.indexReadiness.label} · ${article.indexReadiness.score}`}
                tone={article.indexReadiness.tone}
                icon={<ScanSearch size={18} aria-hidden="true" />}
              />
            </div>

            <Panel title="发布与收录判断" description="先看能不能发，再看能不能被抓取，最后才谈提权。">
              <div className="readiness-summary">
                <div>
                  <strong>{readinessHeadline}</strong>
                  <small className="muted">{qualityGateSummary.next_step}</small>
                </div>
                <Badge tone={qualityGateSummary.publish_ready ? "good" : "warn"}>{qualityGateSummary.score}/100</Badge>
              </div>
              <div className="insight-strip">
                <StatusPill label="可发布" value={qualityGateSummary.publish_ready ? "是" : "否"} tone={qualityGateSummary.publish_ready ? "good" : "warn"} icon={<ShieldCheck size={18} aria-hidden="true" />} />
                <StatusPill label="可收录" value={qualityGateSummary.index_ready ? "是" : "否"} tone={qualityGateSummary.index_ready ? "good" : "warn"} icon={<ScanSearch size={18} aria-hidden="true" />} />
                <StatusPill label="人味分" value={qualityGateSummary.humanizer_score} tone={qualityGateSummary.humanizer_score >= 90 ? "good" : qualityGateSummary.humanizer_score >= 75 ? "warn" : "danger"} icon={<Gauge size={18} aria-hidden="true" />} />
                <StatusPill label="Helpful 分" value={qualityGateSummary.helpful_content_score} tone={qualityGateSummary.helpful_content_score >= 90 ? "good" : qualityGateSummary.helpful_content_score >= 72 ? "warn" : "danger"} icon={<FileText size={18} aria-hidden="true" />} />
              </div>
              <div className="readiness-checks">
                {qualityGateSummary.checks.map((check) => (
                  <div className="readiness-check" key={check.key}>
                    <span className={`readiness-check__mark${check.passed ? " readiness-check__mark--passed" : ""}`}>
                      <ListChecks size={15} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>{check.label}</strong>
                      <small className="muted">{check.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Humanizer 评分" description="这里看文章是不是像真人写的，不只是像一篇合格的 SEO 文稿。">
              <div className="readiness-summary">
                <div>
                  <strong>
                    {qualityGateSummary.humanizer_score >= 90
                      ? "人味很好"
                      : qualityGateSummary.humanizer_score >= 75
                        ? "还有一点模板味"
                        : "明显需要重写"}
                  </strong>
                  <small className="muted">
                    {qualityGateSummary.humanizer_signals.length > 0
                      ? qualityGateSummary.humanizer_signals.join(" · ")
                      : "没有明显的 AI 味或模板句式。"}
                  </small>
                </div>
                <Badge tone={qualityGateSummary.humanizer_score >= 90 ? "good" : qualityGateSummary.humanizer_score >= 75 ? "warn" : "danger"}>
                  {qualityGateSummary.humanizer_score}/100
                </Badge>
              </div>
              <div className="readiness-checks">
                {qualityGateSummary.humanizer_recommendations.length > 0 ? (
                  qualityGateSummary.humanizer_recommendations.map((item) => (
                    <div className="readiness-check" key={item}>
                      <span className="readiness-check__mark">
                        <ListChecks size={15} aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{item}</strong>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="readiness-check">
                    <span className="readiness-check__mark readiness-check__mark--passed">
                      <ListChecks size={15} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>暂无明显修改项</strong>
                      <small className="muted">文章在人味、节奏和信息密度上暂时没有明显问题。</small>
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Helpful Content 评分" description="这里按 Google people-first 内容、ai-marketing-skills 和 seomachine 流程看文章是否真正有用。">
              <div className="readiness-summary">
                <div>
                  <strong>
                    {qualityGateSummary.helpful_content_score >= 90
                      ? "内容对用户很扎实"
                      : qualityGateSummary.helpful_content_score >= 72
                        ? "内容基本有用，还有增强空间"
                        : "需要补真实价值和证据"}
                  </strong>
                  <small className="muted">
                    {qualityGateSummary.helpful_content_signals.length > 0
                      ? qualityGateSummary.helpful_content_signals.join(" · ")
                      : "已覆盖答案、事实、决策、FAQ、链接和引用等基础信号。"}
                  </small>
                </div>
                <Badge tone={qualityGateSummary.helpful_content_score >= 90 ? "good" : qualityGateSummary.helpful_content_score >= 72 ? "warn" : "danger"}>
                  {qualityGateSummary.helpful_content_score}/100
                </Badge>
              </div>
              <div className="readiness-checks">
                {qualityGateSummary.helpful_content_recommendations.length > 0 ? (
                  qualityGateSummary.helpful_content_recommendations.map((item) => (
                    <div className="readiness-check" key={item}>
                      <span className="readiness-check__mark">
                        <ListChecks size={15} aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{item}</strong>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="readiness-check">
                    <span className="readiness-check__mark readiness-check__mark--passed">
                      <ListChecks size={15} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>暂无明显内容价值缺口</strong>
                      <small className="muted">继续发布后看 Search Console 的真实表现。</small>
                    </div>
                  </div>
                )}
                {qualityGateSummary.doctrine_sources.length > 0 ? (
                  <div className="readiness-check">
                    <span className="readiness-check__mark readiness-check__mark--passed">
                      <ListChecks size={15} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>参考规范</strong>
                      <small className="muted">{qualityGateSummary.doctrine_sources.join(" · ")}</small>
                    </div>
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel title="SEO 内容洞察" description="关键词、来源、结构和 agent 轨迹。">
              <div className="insight-strip">
                <StatusPill label="质量门禁" value={qualityGateReady ? "通过" : "未通过"} tone={qualityGateReady ? "good" : "danger"} icon={<ShieldCheck size={18} aria-hidden="true" />} />
                <StatusPill label="收录准备" value={article.indexReadiness.label} tone={article.indexReadiness.tone} icon={<ScanSearch size={18} aria-hidden="true" />} />
                <StatusPill label="SEO 分" value={article.seoScore ?? "暂无"} tone={(article.seoScore ?? 0) >= 82 ? "good" : "warn"} icon={<Gauge size={18} aria-hidden="true" />} />
              </div>
              <div className="readiness-checks">
                <div className="readiness-check">
                  <span className={`readiness-check__mark${qualityGateReady ? " readiness-check__mark--passed" : ""}`}>
                    <ListChecks size={15} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>发布判断</strong>
                    <small className="muted">
                      {qualityGateSummary.publish_ready
                        ? "内容过线，可以进入发布或收录流程。"
                        : "内容还没过线，先做 AI repair 再发布。"}
                    </small>
                  </div>
                </div>
                <div className="readiness-check">
                  <span className={`readiness-check__mark${article.canonicalUrl ? " readiness-check__mark--passed" : ""}`}>
                    <ListChecks size={15} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>收录判断</strong>
                    <small className="muted">
                      {article.canonicalUrl
                        ? "已经有 canonical URL，可进入 Search Console 同步。"
                        : "还没有 canonical URL，不能谈真实收录。"}
                    </small>
                  </div>
                </div>
                {structureChecks.map((check) => (
                  <div className="readiness-check" key={`structure-${check.key}`}>
                    <span className={`readiness-check__mark${check.passed ? " readiness-check__mark--passed" : ""}`}>
                      <ListChecks size={15} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>{check.label}</strong>
                      <small className="muted">{check.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="品牌语气" description="生成和修复会按这里的口径写，避免把品牌词和模板话术塞进正文。">
              {brandVoice.audience || brandVoice.tone || brandVoiceBannedWords.length > 0 || brandVoiceExamples.length > 0 ? (
                <dl className="detail-list">
                  <div>
                    <dt>受众</dt>
                    <dd>{stringValue(brandVoice.audience) ?? "未配置"}</dd>
                  </div>
                  <div>
                    <dt>语气</dt>
                    <dd>{stringValue(brandVoice.tone) ?? "未配置"}</dd>
                  </div>
                  <div>
                    <dt>禁用词</dt>
                    <dd>{brandVoiceBannedWords.length > 0 ? brandVoiceBannedWords.join(" · ") : "无"}</dd>
                  </div>
                  <div>
                    <dt>示例</dt>
                    <dd>{brandVoiceExamples.length > 0 ? brandVoiceExamples.join(" · ") : "无"}</dd>
                  </div>
                </dl>
              ) : (
                <EmptyState title="暂无品牌语气" description="先在品牌语气里配置受众、语气和禁用词，Humanizer 建议会更准。" />
              )}
            </Panel>

            <RepairPlanPanel article={article} repairPlan={repairPlan} />

            <Panel
              title="Google 收录准备"
              description="这里判断的是收录基础和复盘准备，不承诺 Google 一定收录或排名；真正表现要上线后看 Search Console。"
              action={
                article.canonicalUrl ? (
                  <a className="button button--ghost" href={article.canonicalUrl} target="_blank" rel="noreferrer">
                    <LinkIcon size={16} aria-hidden="true" />
                    打开线上
                  </a>
                ) : null
              }
            >
              <div className="next-step-strip">
                <div>
                  <strong>AI 修复是做什么</strong>
                  <small className="muted">
                    修复会读取原文、质检报告、AI 搜索分、内链/引用证据和 Agent 记忆，按 analyze-existing → rewrite → optimize → performance-review 原地改稿，不是简单重跑。
                  </small>
                </div>
                <form action={`/api/admin/articles/${article.id}/repair`} method="post">
                  <input type="hidden" name="repairReason" value="从 Google 收录准备面板触发：根据内容质量、搜索评分、内链、外部引用和 Agent 记忆规则修复。" />
                  <button className="button button--small" type="submit" disabled={article.indexReadiness.checks[0]?.passed}>
                    <Sparkles size={14} aria-hidden="true" />
                    {article.indexReadiness.checks[0]?.passed ? "内容已过线" : "开始修复"}
                  </button>
                </form>
              </div>
              <div className="readiness-summary">
                <div>
                  <strong>{article.indexReadiness.nextStep}</strong>
                  <small className="muted">
                    {article.indexReadiness.lastSearchConsoleSyncAt
                      ? `上次 Search Console 同步：${article.indexReadiness.lastSearchConsoleSyncAt}`
                      : "还没有 Search Console 同步记录。"}
                  </small>
                </div>
                <Badge tone={article.indexReadiness.tone}>{article.indexReadiness.score}/100</Badge>
              </div>
              <div className="readiness-checks">
                {article.indexReadiness.checks.map((check) => (
                  <div className="readiness-check" key={check.key}>
                    <span className={`readiness-check__mark${check.passed ? " readiness-check__mark--passed" : ""}`}>
                      <ListChecks size={15} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>{check.label}</strong>
                      <small className="muted">{check.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
              <div className="next-step-strip">
                <div>
                  <strong>发布后巡检顺序</strong>
                  <small className="muted">先确认线上可打开，再同步 Search Console；有曝光后看 CTR、平均排名和低点击词。</small>
                </div>
                <div className="toolbar">
                  <form action={`/api/admin/articles/${article.id}/search-console`} method="post">
                    <button className="button button--small" type="submit" disabled={!canSyncSearchConsole}>
                      <Search size={14} aria-hidden="true" />
                      同步搜索表现
                    </button>
                  </form>
                  <Link href="/performance-review" className="button button--small">
                    <Gauge size={14} aria-hidden="true" />
                    去复盘
                  </Link>
                </div>
              </div>
            </Panel>

            <ArticleAgentCenter
              article={article}
              qualityReport={qualityReport}
              aiSearchScore={aiSearchScore}
              aiSearchReview={aiSearchReview}
              aiSearchInitial={aiSearchInitial}
              aiSearchFinal={aiSearchFinal}
              aiSearchRevisions={aiSearchRevisions}
              aiSearchActionItems={aiSearchActionItems}
              seoAgent={seoAgent}
              agentStages={agentStages}
              agentToolCalls={agentToolCalls}
              agentReflectionTasks={agentReflectionTasks}
              agentMemory={agentMemory}
              structuredAgentTrace={structuredAgentTrace}
              agentSteps={agentSteps}
              visibleAgentToolCalls={visibleAgentToolCalls}
              visibleReflectionTasks={visibleReflectionTasks}
              executionStepCount={executionStepCount}
              evidenceSummary={evidenceSummary}
            />

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

function RepairPlanPanel({ article, repairPlan }: { article: AdminArticleReviewView; repairPlan: PythonRepairPlan }) {
  const activeTasks = repairPlan.tasks.slice(0, 6);
  const failedChecks = repairPlan.quality_gate.checks.filter((check) => !check.passed).length;

  return (
    <Panel
      title="AI 修复任务流"
      description="这里把 AI 修复拆成负责智能体、具体动作和验收条件，避免流程变成一个黑箱按钮。"
      action={
        <form action={`/api/admin/articles/${article.id}/repair`} method="post">
          <input type="hidden" name="repairReason" value={repairPlan.next_step} />
          <button className="button button--small" type="submit">
            <Sparkles size={14} aria-hidden="true" />
            执行修复
          </button>
        </form>
      }
    >
      <div className="next-step-strip">
        <div>
          <strong>{repairPlan.next_step}</strong>
          <small className="muted">
            {repairPlan.summary} · 未通过检查 {failedChecks} 项 · 模式 {formatRepairMode(repairPlan.mode)}
          </small>
        </div>
        <Badge tone={repairPlan.quality_gate.publish_ready ? "good" : "warn"}>
          {repairPlan.quality_gate.publish_ready ? "发布线已过" : "需要修复"}
        </Badge>
      </div>

      {repairPlan.blockers.length > 0 ? (
        <div className="readiness-checks">
          {repairPlan.blockers.slice(0, 4).map((blocker) => (
            <div className="readiness-check" key={`blocker-${blocker}`}>
              <span className="readiness-check__mark">
                <ListChecks size={15} aria-hidden="true" />
              </span>
              <div>
                <strong>{blocker}</strong>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="list">
        {activeTasks.map((task, index) => (
          <div className="list-item" key={task.id}>
            <div>
              <strong>
                {index + 1}. {formatAgentRole(task.agent_role)} · {task.issue}
              </strong>
              <small className="muted">{task.instruction}</small>
              <small className="muted">验收：{task.acceptance_check}</small>
              {task.depends_on.length > 0 ? <small className="muted">依赖：{task.depends_on.join(" / ")}</small> : null}
            </div>
            <Badge tone={toneForRepairPriority(task.priority)}>{formatRepairPriority(task.priority)}</Badge>
          </div>
        ))}
      </div>

      {activeTasks.length === 0 ? (
        <EmptyState title="暂无修复任务" description="当前没有可执行修复项，继续发布或等待 Search Console 数据。" />
      ) : null}
    </Panel>
  );
}

function buildLocalRepairPlan(article: AdminArticleReviewView | null, qualityGate: PythonQualityGate): PythonRepairPlan {
  const failedChecks = qualityGate.checks.filter((check) => !check.passed);
  const tasks: PythonRepairPlanTask[] = failedChecks
    .filter((check) => ["quality_gate", "content_depth", "title_intent", "summary_meta", "heading_structure", "humanizer", "helpful_content", "internal_links", "external_references", "search_review", "decision_support", "faq", "image_alt", "canonical", "published_url"].includes(check.key))
    .slice(0, 8)
    .map((check) => localRepairTask(check));

  if (qualityGate.publish_ready && !qualityGate.index_ready) {
    tasks.unshift({
      id: "local-publisher-guard",
      agent_role: "publisher_guard",
      priority: "high",
      issue: "内容已过发布线，但还缺少线上发布或 canonical。",
      instruction: "发布到 Shopify 后确认 canonical URL，再进入 Search Console 同步。",
      acceptance_check: "文章有可访问的 canonical URL。",
      source_check_key: "canonical",
      depends_on: [],
      outputs: ["canonical_url"]
    });
  }

  if (qualityGate.index_ready) {
    tasks.push({
      id: "local-growth-analyst",
      agent_role: "growth_analyst",
      priority: "medium",
      issue: "文章已经具备收录观察基础。",
      instruction: "同步 Search Console，查看曝光、平均排名、CTR 和查询缺口。",
      acceptance_check: "生成一组基于真实表现的刷新建议。",
      source_check_key: "search_console",
      depends_on: [],
      outputs: ["search_console_insights"]
    });
  }

  return {
    article_id: article?.id ?? null,
    canonical_url: article?.canonicalUrl ?? null,
    status: article?.status ?? null,
    repair_reason: null,
    mode: article?.status === "published" ? "post_publish_refresh" : qualityGate.publish_ready ? "publish_and_index" : "pre_publish_repair",
    summary: `${tasks.length} 个本地保守修复任务`,
    next_step: tasks[0]?.instruction ?? qualityGate.next_step,
    blockers: failedChecks.map((check) => check.label).slice(0, 6),
    quality_gate: qualityGate,
    tasks
  };
}

function localRepairTask(check: PythonQualityGateCheck): PythonRepairPlanTask {
  const role = ["content_depth", "heading_structure", "decision_support", "faq"].includes(check.key)
    ? "writer"
    : ["internal_links", "external_references"].includes(check.key)
      ? "researcher"
      : "seo_editor";

  return {
    id: `local-${check.key}`,
    agent_role: role,
    priority: ["quality_gate", "content_depth", "humanizer", "helpful_content"].includes(check.key) ? "high" : "medium",
    issue: check.label,
    instruction: localRepairInstruction(check.key),
    acceptance_check: check.detail,
    source_check_key: check.key,
    depends_on: [],
    outputs: [`${check.key}_revision`]
  };
}

function localRepairInstruction(checkKey: string) {
  const instructions: Record<string, string> = {
    quality_gate: "按质量门禁失败项重新修正文稿，再重新评分。",
    content_depth: "补充具体事实、场景、对比和购买前提醒。",
    title_intent: "重写标题，让主关键词和搜索意图更明确。",
    summary_meta: "重写摘要或 meta 描述，给出具体承诺。",
    heading_structure: "重排 H2/H3，让结构更清晰且不跳级。",
    humanizer: "删掉模板句和 AI 味，改成更自然的短句。",
    helpful_content: "补 answer-first、verified facts、决策支持、FAQ 和引用。",
    internal_links: "补相关内部链接，并使用描述性锚文本。",
    external_references: "补可靠外部引用，把来源和具体事实绑定。",
    search_review: "围绕搜索意图和内容深度重写关键段落。",
    decision_support: "补选择/跳过/对比建议。",
    faq: "补至少 3 个真实买家问题和直接答案。",
    image_alt: "把图片 alt 改成能描述具体图像内容的句子。",
    canonical: "发布或补齐 canonical URL。",
    published_url: "发布到 Shopify 后再进行收录观察。"
  };
  return instructions[checkKey] ?? "按检查详情修复并重新验收。";
}

function formatRepairMode(mode: PythonRepairPlan["mode"]) {
  if (mode === "publish_and_index") return "发布与收录准备";
  if (mode === "post_publish_refresh") return "发布后复盘";
  return "发布前修复";
}

function formatAgentRole(role: string) {
  const labels: Record<string, string> = {
    researcher: "Research Agent",
    keyword_planner: "Keyword Planner",
    writer: "Writer Agent",
    seo_editor: "SEO Gate Agent",
    publisher_guard: "Publisher Guard",
    growth_analyst: "Growth Analyst"
  };
  return labels[role] ?? role;
}

function formatRepairPriority(priority: PythonRepairPlanTask["priority"]) {
  const labels: Record<PythonRepairPlanTask["priority"], string> = {
    critical: "紧急",
    high: "高",
    medium: "中",
    low: "低"
  };
  return labels[priority];
}

function toneForRepairPriority(priority: PythonRepairPlanTask["priority"]) {
  if (priority === "critical" || priority === "high") return "danger";
  if (priority === "medium") return "warn";
  return "neutral";
}

function buildLocalQualityGateSummary(input: {
  article: AdminArticleReviewView | null;
  aiSearchScore: number | null;
  editorialScore: number | null;
  expertPanelScore: number | null;
  hasExternalReferences: boolean;
  hasFaq: boolean;
  hasDecisionSupport: boolean;
  imageAltTexts: string[];
}): PythonQualityGate {
  const article = input.article;
  const seoScore = article?.seoScore ?? 0;
  const bodyText = stripHtmlText(article?.bodyHtml ?? "");
  const h2Count = (article?.bodyHtml.match(/<h2\b/gi) ?? []).length;
  const hasInternalLinks = Boolean(article?.bodyHtml.includes("<a "));
  const isPublished = article?.status === "published";
  const hasCanonical = Boolean(article?.canonicalUrl);
  const hasDescriptiveAlt = input.imageAltTexts.length === 0 || input.imageAltTexts.every((alt) => alt.trim().length >= 8 && !["image", "photo", "文章图片", "商品图片"].includes(alt.trim().toLowerCase()));
  const summary = article?.seoDescription ?? article?.summary ?? "";
  const summaryMin = /[\u3400-\u9fff]/u.test(summary) ? 40 : 80;
  const summaryMax = /[\u3400-\u9fff]/u.test(summary) ? 160 : 180;
  const checks: PythonQualityGateCheck[] = [
    localCheck("quality_gate", "Quality gate", Boolean(article?.qualityPassed) && seoScore >= 82, article?.qualityPassed ? `SEO ${seoScore}; content quality passed.` : "Content quality has not passed."),
    localCheck("content_depth", "Useful depth", bodyText.length >= 1200, `Body text length is ${bodyText.length} characters.`),
    localCheck("title_intent", "Title matches intent", Boolean(article?.title && article.title.length >= 8 && article.title.length <= 72), `Title length ${article?.title.length ?? 0}; keep it specific and scannable.`),
    localCheck("summary_meta", "Summary and meta description", summary.length >= summaryMin && summary.length <= summaryMax, `Summary/meta length ${summary.length}; target ${summaryMin}-${summaryMax} characters.`),
    localCheck("heading_structure", "Heading structure", h2Count >= 3, `${h2Count} H2 sections found; target at least 3.`),
    localCheck("internal_links", "Internal links", hasInternalLinks, hasInternalLinks ? "Contextual links are present." : "No contextual anchor tag found in the article body."),
    localCheck("external_references", "External references", input.hasExternalReferences, input.hasExternalReferences ? "External reference metadata exists." : "No approved external reference metadata found."),
    localCheck("search_review", "AI search review", (input.aiSearchScore ?? seoScore) >= 82, `AI/search score ${input.aiSearchScore ?? seoScore}; target 82.`),
    localCheck("decision_support", "Decision support", input.hasDecisionSupport || /choose|skip|适合|不适合|对比|下单前/i.test(bodyText), "Article should help shoppers choose, skip, compare, or continue."),
    localCheck("faq", "Search-intent FAQ", input.hasFaq, "FAQ should answer real buyer/search questions."),
    localCheck("image_alt", "Image alt text", hasDescriptiveAlt, input.imageAltTexts.length ? `${input.imageAltTexts.length} image alt text value(s).` : "No image alt text supplied."),
    localCheck("canonical", "Canonical URL", hasCanonical, hasCanonical ? "Canonical URL is saved." : "Canonical URL is missing."),
    localCheck("published_url", "Published URL", isPublished, isPublished ? "Article is published." : "Article is not published yet.")
  ];
  const requiredPublishKeys = new Set(["quality_gate", "content_depth", "title_intent", "summary_meta", "heading_structure", "internal_links", "external_references", "search_review", "decision_support", "faq", "image_alt"]);
  const publishReady = checks.filter((check) => requiredPublishKeys.has(check.key)).every((check) => check.passed);
  const indexReady = publishReady && isPublished && hasCanonical;

  return {
    publish_ready: publishReady,
    index_ready: indexReady,
    score: Math.round((checks.filter((check) => check.passed).length / checks.length) * 100),
    checks,
    next_step: !publishReady
      ? "先做 AI 修复，让内容结构、链接、引用和 FAQ 过线。"
      : !isPublished
        ? "先发布到 Shopify，生成线上 URL 后再谈收录。"
        : !hasCanonical
          ? "补齐 canonical URL，再同步 Search Console。"
          : "同步 Search Console，继续看抓取、曝光、排名和 CTR。",
    humanizer_score: seoScore,
    humanizer_signals: [],
    humanizer_recommendations: [],
    helpful_content_score: seoScore,
    helpful_content_signals: [],
    helpful_content_recommendations: [],
    doctrine_sources: []
  };
}

function resolveReadinessHeadline(article: AdminArticleReviewView | null, qualityGate: PythonQualityGate) {
  if (!qualityGate.publish_ready) return "先修复内容再发布";
  if (article?.status !== "published") return "可以发布，但还不能判断收录";
  if (!qualityGate.index_ready) return "已发布，但还要补 canonical 或搜索同步";
  return "已具备收录观察基础";
}

function localCheck(key: string, label: string, passed: boolean, detail: string): PythonQualityGateCheck {
  return { key, label, passed, detail };
}

function stripHtmlText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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
        {items.map((item, index) => (
          <div key={`${title}-${index}-${item}`}>
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
