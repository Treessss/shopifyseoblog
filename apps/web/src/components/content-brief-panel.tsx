import { CheckCircle2, FileText, ListTodo, Search, Sparkles } from "lucide-react";
import { Badge, StatusPill } from "@/components/ui";
import type { PythonContentArticleBrief } from "@/lib/agent-center/python-agent-client";

export function ContentBriefPanel({ brief }: { brief: PythonContentArticleBrief }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Python Article Brief</h2>
          <p>把研究、写作、SEO 和发布边界收拢成一张可执行的文章蓝图。</p>
        </div>
      </div>

      <div className="insight-strip">
        <StatusPill label="模式" value={brief.mode} tone="neutral" icon={<FileText size={18} aria-hidden="true" />} />
        <StatusPill label="主题" value={brief.topic} tone="good" icon={<Sparkles size={18} aria-hidden="true" />} />
        <StatusPill label="主关键词" value={brief.primary_keyword} tone="warn" icon={<Search size={18} aria-hidden="true" />} />
        <StatusPill label="区块数" value={brief.sections.length} tone="good" icon={<ListTodo size={18} aria-hidden="true" />} />
      </div>

      <div className="grid grid--two">
        <div className="list">
          <div className="list-item">
            <div>
              <strong>受众</strong>
              <small className="muted">{brief.audience}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>搜索意图</strong>
              <small className="muted">{brief.search_intent}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>开场角度</strong>
              <small className="muted">{brief.opening_angle}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>摘要</strong>
              <small className="muted">{brief.summary}</small>
            </div>
          </div>
        </div>

        <div className="list">
          <div className="list-item">
            <div>
              <strong>H1</strong>
              <small className="muted">{brief.h1}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Title options</strong>
              <small className="muted">{brief.title_options.join(" · ")}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Meta title</strong>
              <small className="muted">{brief.meta_title_options.join(" · ")}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Meta description</strong>
              <small className="muted">{brief.meta_description_options.join(" · ")}</small>
            </div>
          </div>
        </div>
      </div>

      <div className="readiness-checks">
        {brief.sections.map((section) => (
          <div className="readiness-check" key={section.key}>
            <span className="readiness-check__mark readiness-check__mark--passed">
              <CheckCircle2 size={15} aria-hidden="true" />
            </span>
            <div>
              <strong>{section.heading}</strong>
              <small className="muted">{section.purpose}</small>
              <small className="muted">
                Agent：{formatAgentRole(section.agent_role)} · 字数：{section.target_words}
              </small>
              <small className="muted">Must have：{section.must_have.join(" / ")}</small>
              <small className="muted">Avoid：{section.avoid.join(" / ")}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid--two">
        <div className="list">
          <div className="list-item">
            <div>
              <strong>FAQ questions</strong>
              <small className="muted">{brief.faq_questions.join(" · ")}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Internal links</strong>
              <small className="muted">{brief.internal_link_plan.join(" · ")}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>External references</strong>
              <small className="muted">{brief.external_reference_plan.join(" · ")}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Humanizer notes</strong>
              <small className="muted">{brief.humanizer_notes.join(" · ")}</small>
            </div>
          </div>
        </div>

        <div className="list">
          <div className="list-item">
            <div>
              <strong>SEO rules</strong>
              <small className="muted">{brief.seo_rules.join(" · ")}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Publish rules</strong>
              <small className="muted">{brief.publish_rules.join(" · ")}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Blockers</strong>
              <small className="muted">{brief.blockers.length > 0 ? brief.blockers.join(" · ") : "none"}</small>
            </div>
            <Badge tone={brief.blockers.length > 0 ? "warn" : "good"}>
              {brief.blockers.length > 0 ? "需补齐" : "已通过"}
            </Badge>
          </div>
          <div className="list-item">
            <div>
              <strong>Next step</strong>
              <small className="muted">{brief.next_step}</small>
            </div>
          </div>
        </div>
      </div>

      {brief.doctrine_sources.length > 0 ? (
        <div className="list">
          {brief.doctrine_sources.map((source) => (
            <div className="list-item" key={source}>
              <div>
                <strong>{source}</strong>
              </div>
              <Badge tone="neutral">source</Badge>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatAgentRole(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
