import { CircleCheckBig, Clock3, Gauge, ShieldCheck, Workflow } from "lucide-react";
import { Badge, StatusPill } from "@/components/ui";
import type { PythonWorkflowExecutionPlan } from "@/lib/agent-center/python-agent-client";

export function PythonExecutionPlanPanel({ plan }: { plan: PythonWorkflowExecutionPlan }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Python Execution Plan</h2>
          <p>把 workflow 变成能排队执行的 agent 任务、依赖和运行约束。</p>
        </div>
      </div>

      <div className="insight-strip">
        <StatusPill label="运行状态" value={plan.runtime_status} tone={toneForStatus(plan.runtime_status)} icon={<Workflow size={18} aria-hidden="true" />} />
        <StatusPill label="可执行" value={plan.ready_task_count} tone="good" icon={<CircleCheckBig size={18} aria-hidden="true" />} />
        <StatusPill label="等待中" value={plan.pending_task_count} tone={plan.pending_task_count > 0 ? "warn" : "neutral"} icon={<Clock3 size={18} aria-hidden="true" />} />
        <StatusPill label="被阻塞" value={plan.blocked_task_count} tone={plan.blocked_task_count > 0 ? "danger" : "good"} icon={<ShieldCheck size={18} aria-hidden="true" />} />
      </div>

      <div className="grid grid--two">
        <div className="list">
          <div className="list-item">
            <div>
              <strong>主题</strong>
              <small className="muted">{plan.topic}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>主关键词</strong>
              <small className="muted">{plan.primary_keyword}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Publish policy</strong>
              <small className="muted">{plan.publish_policy}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Idempotency key</strong>
              <small className="muted code">{plan.idempotency_key}</small>
            </div>
          </div>
        </div>

        <div className="list">
          <div className="list-item">
            <div>
              <strong>Next step</strong>
              <small className="muted">{plan.next_step}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Summary</strong>
              <small className="muted">{plan.summary}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Required integrations</strong>
              <small className="muted">{plan.required_integrations.join(" · ")}</small>
            </div>
          </div>
          <div className="list-item">
            <div>
              <strong>Active task</strong>
              <small className="muted">{plan.active_task_id ?? "none"}</small>
            </div>
          </div>
        </div>
      </div>

      <div className="readiness-checks">
        {plan.tasks.map((task) => (
          <div className="readiness-check readiness-check--execution" key={task.id}>
            <span className={`readiness-check__mark readiness-check__mark--${markTone(task.status)}`}>
              <Gauge size={15} aria-hidden="true" />
            </span>
            <div>
              <strong>{task.title}</strong>
              <small className="muted">
                Agent：{formatAgentRole(task.agent_role)} · 队列：#{task.queue_position} · 预计 {task.estimated_minutes} 分钟
              </small>
              <small className="muted">目标：{task.objective}</small>
              <small className="muted">Inputs：{task.required_inputs.join(" / ") || "none"}</small>
              <small className="muted">Integrations：{task.required_integrations.join(" / ") || "none"}</small>
              <small className="muted">Artifacts：{task.output_artifacts.join(" / ") || "none"}</small>
              <small className="muted">Handoff：{task.handoff_note}</small>
              {task.blocking_reasons.length > 0 ? <small className="muted">Blockers：{task.blocking_reasons.join(" · ")}</small> : null}
            </div>
            <div className="execution-task-meta">
              <Badge tone={toneForStatus(task.status)}>{task.status}</Badge>
              <span className="muted">retry {task.retry_policy.max_attempts}x</span>
            </div>
          </div>
        ))}
      </div>

      {(plan.workflow_blockers.length > 0 || plan.runtime_blockers.length > 0) ? (
        <div className="grid grid--two">
          <div className="list">
            <div className="list-item">
              <div>
                <strong>Workflow blockers</strong>
                <small className="muted">{plan.workflow_blockers.join(" · ")}</small>
              </div>
            </div>
          </div>
          <div className="list">
            <div className="list-item">
              <div>
                <strong>Runtime blockers</strong>
                <small className="muted">{plan.runtime_blockers.join(" · ")}</small>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {plan.doctrine_sources.length > 0 ? (
        <div className="list">
          {plan.doctrine_sources.map((source) => (
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

function toneForStatus(status: string): "good" | "warn" | "danger" | "neutral" {
  if (status === "ready") return "good";
  if (status === "degraded") return "warn";
  if (status === "blocked") return "danger";
  return "neutral";
}

function markTone(status: string) {
  if (status === "ready") return "passed";
  if (status === "blocked") return "danger";
  return "pending";
}

function formatAgentRole(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
