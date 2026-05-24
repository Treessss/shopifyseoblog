import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Globe2, ListTodo, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, ErrorState, PageHeader, Panel, StatusPill } from "@/components/ui";
import {
  getPythonContentReadinessDoctrine,
  type PythonContentReadinessDoctrine,
  type PythonContentReadinessStage
} from "@/lib/agent-center/python-agent-client";
import { getDashboardView, getSearchConsoleView } from "@/lib/admin-client";

export default async function ContentRulesPage() {
  const [dashboard, searchConsole, pythonDoctrine] = await Promise.all([
    getDashboardView(),
    getSearchConsoleView(),
    getPythonContentReadinessDoctrine()
  ]);
  const doctrine = pythonDoctrine ?? FALLBACK_CONTENT_READINESS_DOCTRINE;
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
