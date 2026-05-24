import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Globe2, ListTodo, Search, ShieldCheck, Sparkles } from "lucide-react";
import { ContentBriefPanel } from "@/components/content-brief-panel";
import { Badge, ErrorState, PageHeader, Panel, StatusPill } from "@/components/ui";
import {
  getPythonContentArticleBrief,
  getPythonContentArticleBlueprint,
  getPythonContentReadinessDoctrine,
  type PythonContentArticleBlueprint,
  type PythonContentArticleBrief,
  type PythonContentReadinessDoctrine,
  type PythonContentReadinessStage
} from "@/lib/agent-center/python-agent-client";
import { getDashboardView, getSearchConsoleView } from "@/lib/admin-client";

export default async function ContentRulesPage() {
  const [dashboard, searchConsole] = await Promise.all([
    getDashboardView(),
    getSearchConsoleView()
  ]);
  const briefRequest = {
    organization_id: "preview",
    store_id: dashboard.data.stores[0]?.id ?? "preview-store",
    locale: dashboard.data.stores[0]?.locale ?? "zh-CN",
    source_type: "manual_topic" as const,
    topic: dashboard.data.articles[0]?.title ?? "Shopify SEO buying guide",
    primary_keyword: dashboard.data.articles[0]?.primaryKeyword ?? "Shopify SEO",
    publish_policy: "manual_review" as const,
    target_word_count: 1600,
    available_internal_links: dashboard.data.articles.length,
    available_external_references: searchConsole.data.snapshots.length,
    recent_topic_count: dashboard.data.campaigns.length,
    search_console_connected: searchConsole.data.properties.some((property) => property.status === "active")
  };
  const [pythonDoctrine, pythonBlueprint, pythonBrief] = await Promise.all([
    getPythonContentReadinessDoctrine(),
    getPythonContentArticleBlueprint(),
    getPythonContentArticleBrief(briefRequest)
  ]);
  const doctrine = pythonDoctrine ?? FALLBACK_CONTENT_READINESS_DOCTRINE;
  const blueprint = pythonBlueprint ?? FALLBACK_CONTENT_ARTICLE_BLUEPRINT;
  const brief = pythonBrief ?? FALLBACK_CONTENT_ARTICLE_BRIEF;
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
        {!pythonDoctrine ? (
          <ErrorState
            title="Python 内容准则服务未启用"
            message="当前使用前端内置准则；打开 PYTHON_AGENT_SERVICE_ENABLED 后会读取后端 doctrine。"
          />
        ) : null}

        <div className="insight-strip">
          <StatusPill label="健康店铺" value={healthyStores} tone={healthyStores > 0 ? "good" : "warn"} icon={<CheckCircle2 size={18} aria-hidden="true" />} />
          <StatusPill label="可发布文章" value={readyArticles.length} tone={readyArticles.length > 0 ? "good" : "neutral"} icon={<Sparkles size={18} aria-hidden="true" />} />
          <StatusPill label="已上线文章" value={publishedArticles.length} tone={publishedArticles.length > 0 ? "good" : "neutral"} icon={<ShieldCheck size={18} aria-hidden="true" />} />
          <StatusPill label="canonical 页面" value={articlesWithCanonical.length} tone={articlesWithCanonical.length > 0 ? "good" : "neutral"} icon={<Globe2 size={18} aria-hidden="true" />} />
        </div>

        <div className="grid grid--two">
          <Panel title="三个判断标准" description="系统会按这三层来判断文章现在到底走到哪一步。">
            <div className="list">
              {doctrine.stages.map((stage) => (
                <div className="list-item" key={stage.key}>
                  <div>
                    <strong>{stage.label}</strong>
                    <small className="muted">{stage.summary}</small>
                  </div>
                  <Badge tone={readinessTone(stage)}>{stage.badge}</Badge>
                </div>
              ))}
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

        <Panel title="Agent 执行规则" description="每个阶段都要有证据，不靠“看起来生成完了”来推进。">
          <div className="readiness-checks">
            {doctrine.stages.map((stage) => (
              <div className="readiness-check" key={`execution-${stage.key}`}>
                <span className="readiness-check__mark readiness-check__mark--passed">
                  <CheckCircle2 size={15} aria-hidden="true" />
                </span>
                <div>
                  <strong>{stage.label}</strong>
                  <small className="muted">
                    {stage.required_checks.slice(0, 2).join(" · ")} · 下一步：{stage.next_action}
                  </small>
                  <small className="muted">
                    Agent：{stage.agent_roles.map(formatAgentRole).join(" / ")} · 证据：{stage.evidence_required.slice(0, 3).join(" / ")}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="文章蓝图" description={blueprint.summary}>
          <div className="readiness-summary">
            <div>
              <strong>{blueprint.article_type}</strong>
              <small className="muted">
                受众：{blueprint.audience} · 目标长度：{blueprint.target_length}
              </small>
            </div>
            <Badge tone="neutral">{blueprint.outline.length} 个区块</Badge>
          </div>
          <div className="readiness-checks">
            {blueprint.outline.map((section) => (
              <div className="readiness-check" key={section.key}>
                <span className="readiness-check__mark readiness-check__mark--passed">
                  <CheckCircle2 size={15} aria-hidden="true" />
                </span>
                <div>
                  <strong>{section.title}</strong>
                  <small className="muted">{section.purpose}</small>
                  <small className="muted">
                    Agent：{formatAgentRole(section.agent_role)} · 字数：{section.target_words}
                  </small>
                  <small className="muted">Must have：{section.must_have.join(" / ")}</small>
                  <small className="muted">Avoid：{section.avoid.join(" / ")}</small>
                  {section.quality_gate ? <small className="muted">门槛：{section.quality_gate}</small> : null}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <ContentBriefPanel brief={brief} />

        <div className="grid grid--two">
          <Panel title="SEO 规则" description="这些规则会在生成、修复和审核里反复引用。">
            <div className="list">
              {blueprint.seo_rules.map((rule) => (
                <div className="list-item" key={rule}>
                  <div>
                    <strong>{rule}</strong>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Humanizer 规则" description="把 AI 味压下去，让文章更像真实编辑写的。">
            <div className="list">
              {blueprint.humanizer_rules.map((rule) => (
                <div className="list-item" key={rule}>
                  <div>
                    <strong>{rule}</strong>
                  </div>
                </div>
              ))}
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

        <Panel title="准则来源" description={doctrine.no_guarantee_notice}>
          <div className="list">
            {doctrine.doctrine_sources.map((source) => (
              <div className="list-item" key={source}>
                <div>
                  <strong>{source}</strong>
                </div>
                <Badge tone="neutral">source</Badge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="发布边界" description="蓝图只定义怎么写，真正是否能发、能不能收录、能不能排名，仍然要看后端 gate 与 Search Console。">
          <div className="list">
            {blueprint.publish_rules.map((rule) => (
              <div className="list-item" key={rule}>
                <div>
                  <strong>{rule}</strong>
                </div>
              </div>
            ))}
            <div className="list-item">
              <div>
                <strong>Anti-patterns</strong>
                <small className="muted">{blueprint.anti_patterns.join(" · ")}</small>
              </div>
            </div>
            <div className="list-item">
              <div>
                <strong>蓝图来源</strong>
                <small className="muted">{blueprint.doctrine_sources.join(" · ")}</small>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function readinessTone(stage: PythonContentReadinessStage): "good" | "warn" | "danger" | "neutral" {
  if (stage.key === "index_ready") return "good";
  if (stage.tone === "critical") return "danger";
  if (stage.tone === "high" || stage.tone === "medium") return "warn";
  return "neutral";
}

function formatAgentRole(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const FALLBACK_CONTENT_ARTICLE_BLUEPRINT: PythonContentArticleBlueprint = {
  article_type: "Shopify SEO blog article",
  summary:
    "Use this blueprint to generate a buyer-useful blog post that reads like a human draft, passes the quality gate, and stays grounded in evidence.",
  audience: "Shopify shoppers, operators, and buyers comparing products or decisions.",
  target_length: "1500-2200 words",
  outline: [
    {
      key: "answer_first_intro",
      title: "Answer-first intro",
      agent_role: "writer",
      purpose: "Open with the direct answer, why it matters, and what the reader will get.",
      target_words: 160,
      must_have: ["Primary keyword in the first 100 words", "One direct answer to the query", "One concrete buyer promise"],
      avoid: ["Generic lead-in", "Future outlook section", "Empty motivational language"],
      quality_gate: "The reader should understand the answer in a few seconds."
    },
    {
      key: "verified_facts",
      title: "Verified facts and context",
      agent_role: "researcher",
      purpose: "Separate confirmed facts from unknowns and anchor the article in real store evidence.",
      target_words: 320,
      must_have: ["Confirmed product or store facts", "Specific numbers or details where available", "Clear labels for unknown or unconfirmed claims"],
      avoid: ["Industry reports", "Sources suggest", "Vague attribution"],
      quality_gate: "Claims must be supportable by Shopify data or approved references."
    },
    {
      key: "decision_support",
      title: "Decision support",
      agent_role: "writer",
      purpose: "Help the reader choose, compare, or skip with practical trade-offs.",
      target_words: 380,
      must_have: ["Choose this if / skip this if guidance", "A comparison table or decision matrix", "One concrete recommendation for each major scenario"],
      avoid: ["Pure promotion", "No trade-off framing", "Overstated certainty"],
      quality_gate: "The article should help someone make a purchase or next-step decision."
    },
    {
      key: "faq_section",
      title: "FAQ",
      agent_role: "seo_editor",
      purpose: "Answer real buyer questions with short, direct replies and clear headings.",
      target_words: 260,
      must_have: ["At least 3 real questions", "Question-style headings", "Direct answers beneath each question"],
      avoid: ["Thin FAQ filler", "Duplicate questions", "Answers that dodge the question"],
      quality_gate: "FAQ depth should reflect real search intent, not padding."
    },
    {
      key: "publish_check",
      title: "Publish check",
      agent_role: "publisher_guard",
      purpose: "Confirm metadata, links, images, and canonical readiness before the article goes live.",
      target_words: 160,
      must_have: ["Meta title and meta description", "Descriptive internal and external links", "Descriptive alt text for images"],
      avoid: ["Click here anchors", "Missing canonical URL", "Unclear publish target"],
      quality_gate: "Do not treat the article as index-ready until the public URL exists."
    },
    {
      key: "post_publish_review",
      title: "Post-publish review",
      agent_role: "growth_analyst",
      purpose: "Use Search Console to decide refresh, expansion, or title/meta changes after publish.",
      target_words: 120,
      must_have: ["Impressions", "CTR", "Average position", "Query gaps"],
      avoid: ["Ranking guarantees", "Opinion without evidence", "One-off vanity fixes"],
      quality_gate: "Only real Search Console data should drive rank-ready decisions."
    }
  ],
  seo_rules: [
    "Put the primary keyword in the title, first 100 words, and one H2 where it fits naturally.",
    "Use 3-5 substantive H2 sections with descriptive headings.",
    "Keep meta titles around 50-60 characters and meta descriptions around 150-160 characters.",
    "Use descriptive anchor text for internal and external links.",
    "Add descriptive alt text to images and keep it specific.",
    "Use canonical URLs after publish, then validate Search Console performance before ranking claims."
  ],
  humanizer_rules: [
    "Start with the answer, not with a long preamble.",
    "Prefer short, concrete verbs and specific examples over abstract phrasing.",
    "Keep sentence rhythm mixed so the copy feels written, not auto-generated.",
    "Avoid banned AI vocabulary such as leverage, nuanced, tapestry, and robust.",
    "Avoid formulaic sections like 'future outlook' or generic 'despite the challenges' endings.",
    "Avoid click here, learn more, and other weak anchor text.",
    "Avoid overusing em dashes, boldface, and rule-of-three patterns.",
    "Use direct opinions when the data supports them."
  ],
  publish_rules: [
    "Publish only when the quality gate, helpful-content review, and humanizer review all pass.",
    "Do not mark the article as rank-ready without Search Console evidence.",
    "Separate publish-ready from index-ready and rank-ready in the UI.",
    "Treat post-publish performance as a new optimization loop, not a final score."
  ],
  anti_patterns: [
    "Vague attributions",
    "Generic positive conclusions",
    "Future outlook sections",
    "Em dash overuse",
    "Click here anchors",
    "AI vocabulary clustering",
    "Undue notability claims",
    "Formulaic challenge-and-future endings"
  ],
  doctrine_sources: [
    "Google Search Central: Creating helpful, reliable, people-first content",
    "Google Search Central: SEO starter guide",
    "Google Search Console: Performance report metrics for queries, CTR, and average position",
    "ericosiu/ai-marketing-skills: seo-ops, content-ops humanizer, and content quality rubrics",
    "TheCraigHewitt/seomachine: research -> write -> optimize -> performance-review workflow"
  ]
};

const FALLBACK_CONTENT_ARTICLE_BRIEF: PythonContentArticleBrief = {
  mode: "new_article",
  topic: "Shopify SEO buying guide",
  primary_keyword: "Shopify SEO",
  audience: "Readers looking for a practical buying guide.",
  search_intent: "Informational with buying signals",
  summary: "Use this brief to draft a human-style Shopify SEO article that answers the question fast and stays grounded in evidence.",
  opening_angle: "Lead with the direct answer, then expand into evidence and practical trade-offs.",
  title_options: [
    "How to Shopify SEO",
    "Shopify SEO: A Practical SEO Guide",
    "What to Know Before You Buy Shopify SEO"
  ],
  meta_title_options: [
    "How to Shopify SEO | Shopify Guide",
    "Shopify SEO Buying Guide | Shopify",
    "Shopify SEO: Human SEO Brief | Shopify"
  ],
  meta_description_options: [
    "Read a human-style Shopify SEO guide built for informational intent, strong structure, and SEO readiness.",
    "Use this brief to turn Shopify SEO into a useful, searchable Shopify article."
  ],
  h1: "How to Shopify SEO",
  sections: FALLBACK_CONTENT_ARTICLE_BLUEPRINT.outline.map((section) => ({
    key: section.key,
    heading: fallbackBriefHeading(section.key),
    agent_role: section.agent_role,
    purpose: section.purpose,
    target_words: section.target_words,
    must_have: section.must_have,
    avoid: section.avoid
  })),
  faq_questions: [
    "What is the fastest way to choose Shopify SEO?",
    "What should I verify before I publish this article?",
    "When should I refresh the article after launch?"
  ],
  internal_link_plan: [
    "Plan one product link, one collection link, and one related article link once the catalog is synced."
  ],
  external_reference_plan: [
    "Cite approved external sources for any factual or trend-based claim.",
    "Tie every citation to one specific sentence or decision point."
  ],
  humanizer_notes: [
    "Start with the answer, not with a long preamble.",
    "Prefer short, concrete verbs and specific examples over abstract phrasing."
  ],
  seo_rules: [
    "Put the primary keyword in the title, first 100 words, and one H2 where it fits naturally.",
    "Use 3-5 substantive H2 sections with descriptive headings."
  ],
  publish_rules: [
    "Publish only when the quality gate, helpful-content review, and humanizer review all pass.",
    "Do not mark the article as rank-ready without Search Console evidence."
  ],
  blockers: [],
  next_step: "Use the brief to draft the article, then run the quality gate before publish.",
  doctrine_sources: [
    "Google Search Central: Creating helpful, reliable, people-first content",
    "Google Search Central: SEO starter guide",
    "ericosiu/ai-marketing-skills: seo-ops, content-ops humanizer, and content quality rubrics"
  ]
};

function fallbackBriefHeading(sectionKey: string) {
  const headings: Record<string, string> = {
    answer_first_intro: "Quick answer",
    verified_facts: "What is confirmed about Shopify SEO",
    decision_support: "How to choose Shopify SEO",
    faq_section: "FAQ",
    publish_check: "Before you publish",
    post_publish_review: "After launch"
  };
  return headings[sectionKey] ?? sectionKey.replaceAll("_", " ");
}

const FALLBACK_CONTENT_READINESS_DOCTRINE: PythonContentReadinessDoctrine = {
  default_sequence: ["publish_ready", "index_ready", "rank_ready"],
  no_guarantee_notice:
    "系统只能判断发布、抓取和复盘准备度；Google 收录和排名提升不能保证，必须以上线后的 Search Console 证据继续优化。",
  doctrine_sources: [
    "Google Search Central: Creating helpful, reliable, people-first content",
    "Google Search Central: SEO starter guide",
    "Google Search Console: Performance report metrics for queries, CTR, and average position",
    "ericosiu/ai-marketing-skills: seo-ops, content-ops humanizer, and content quality rubrics",
    "TheCraigHewitt/seomachine: research -> write -> optimize -> performance-review workflow"
  ],
  stages: [
    {
      key: "publish_ready",
      label: "Publish-ready",
      badge: "发前检查",
      tone: "high",
      summary: "内容质量、结构、证据、人味和 SEO 基础都过线后，才进入 Shopify 发布。",
      required_checks: [
        "Quality gate passed and SEO score reaches the configured publish threshold.",
        "Title, summary, meta description, headings, FAQ, image alt text, and links are specific.",
        "Helpful Content and Humanizer reviews pass without template-heavy or unsupported claims."
      ],
      agent_roles: ["writer", "seo_editor", "researcher"],
      evidence_required: ["article draft HTML", "quality gate scores", "humanizer signals"],
      next_action: "Run repair tasks for any failed publish gate before sending the article to Shopify."
    },
    {
      key: "index_ready",
      label: "Index-ready",
      badge: "可收录",
      tone: "medium",
      summary: "文章已经发布，并且有可访问 canonical URL，Google 才有可抓取页面。",
      required_checks: [
        "Publish-ready checks are already true.",
        "Shopify publish action completed successfully.",
        "Canonical URL exists and points to the preferred public article URL."
      ],
      agent_roles: ["publisher_guard", "growth_analyst"],
      evidence_required: ["published article status", "canonical URL", "storefront reachable URL"],
      next_action: "Publish or repair the canonical URL, then sync Search Console for real visibility data."
    },
    {
      key: "rank_ready",
      label: "Rank-ready",
      badge: "需验证",
      tone: "low",
      summary: "排名优化必须用 Search Console 的曝光、CTR、平均排名和 query gap 来判断，不能只看生成结果。",
      required_checks: [
        "Index-ready checks are true and the article has time to gather search data.",
        "Search Console impressions, clicks, CTR, and average position are available.",
        "Query gaps, low-CTR queries, and striking-distance keywords are reviewed."
      ],
      agent_roles: ["growth_analyst", "seo_editor", "keyword_planner"],
      evidence_required: ["Search Console impressions", "Search Console clicks and CTR", "average position"],
      next_action: "Use Search Console evidence to choose refresh, title/meta, internal-link, or expansion tasks."
    }
  ]
};
