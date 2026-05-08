import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Inbox, Loader2, XCircle } from "lucide-react";

type BadgeTone = "good" | "warn" | "danger" | "neutral";
type ErrorLike = { message: string; status?: number | string };

export function PageHeader(props: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      {props.action ? <div className="page-header__action">{props.action}</div> : null}
    </div>
  );
}

export function MetricCard(props: { label: string; value: ReactNode; detail: string; tone?: BadgeTone; icon?: ReactNode }) {
  return (
    <article className={`metric-card metric-card--${props.tone ?? "neutral"}`}>
      <div className="metric-card__label">
        <span>{props.label}</span>
        {props.icon ? <span className="metric-card__icon">{props.icon}</span> : null}
      </div>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </article>
  );
}

export function Panel(props: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`panel${props.compact ? " panel--compact" : ""}`}>
      {props.title || props.description || props.action ? (
        <div className="panel__header">
          <div>
            {props.title ? <h2>{props.title}</h2> : null}
            {props.description ? <p>{props.description}</p> : null}
          </div>
          {props.action ? <div className="panel__action">{props.action}</div> : null}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

export function Badge(props: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`badge badge--${props.tone ?? "neutral"}`}>{props.children}</span>;
}

export function StatusPill(props: { label: string; value: ReactNode; tone?: BadgeTone; icon?: ReactNode }) {
  return (
    <div className={`status-pill status-pill--${props.tone ?? "neutral"}`}>
      <span className="status-pill__icon">{props.icon ?? <CheckCircle2 size={18} aria-hidden="true" />}</span>
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
      </div>
    </div>
  );
}

export function FormNotice(props: { tone: "good" | "danger"; title: string; message: string }) {
  const Icon = props.tone === "good" ? CheckCircle2 : XCircle;

  return (
    <div className={`state-card state-card--${props.tone}`} role={props.tone === "danger" ? "alert" : "status"}>
      <Icon size={22} aria-hidden="true" />
      <div>
        <strong>{props.title}</strong>
        <p>{props.message}</p>
      </div>
    </div>
  );
}

export function ProgressBar(props: { value: number }) {
  const value = Math.max(0, Math.min(100, props.value));
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

export function Field(props: {
  label: string;
  name?: string;
  value?: string | number | null;
  hint?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  autoComplete?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.value ?? ""}
        placeholder={props.placeholder}
        required={props.required}
        readOnly={props.readOnly}
        disabled={props.disabled}
        min={props.min}
        max={props.max}
        step={props.step}
        autoComplete={props.autoComplete}
      />
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}

export function TextAreaField(props: {
  label: string;
  name?: string;
  value?: string | string[] | null;
  hint?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
}) {
  const value = Array.isArray(props.value) ? props.value.join("\n") : (props.value ?? "");

  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea
        name={props.name}
        defaultValue={value}
        rows={props.rows ?? 5}
        placeholder={props.placeholder}
        required={props.required}
        disabled={props.disabled}
      />
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}

export function SelectField(props: {
  label: string;
  name: string;
  value?: string | null;
  options: Array<{ label: string; value: string }>;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select name={props.name} defaultValue={props.value ?? ""} required={props.required} disabled={props.disabled}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}

export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="state-card">
      <Inbox size={22} aria-hidden="true" />
      <div>
        <strong>{props.title}</strong>
        <p>{props.description}</p>
      </div>
      {props.action ? <div className="state-card__action">{props.action}</div> : null}
    </div>
  );
}

export function ErrorState(props: { title?: string; message?: string; error?: ErrorLike | null }) {
  if (!props.message && !props.error) return null;

  const message = props.message ?? props.error?.message ?? "管理端接口暂时不可用";
  const status = props.error?.status ? `（HTTP ${props.error.status}）` : "";

  return (
    <div className="state-card state-card--error" role="alert">
      <AlertCircle size={22} aria-hidden="true" />
      <div>
        <strong>{props.title ?? "数据加载失败"}</strong>
        <p>
          {message}
          {status}
        </p>
      </div>
    </div>
  );
}

export function TableEmpty(props: { colSpan: number; title: string; description: string }) {
  return (
    <tr>
      <td colSpan={props.colSpan}>
        <EmptyState title={props.title} description={props.description} />
      </td>
    </tr>
  );
}

export function FilterBar(props: { children: ReactNode; summary?: ReactNode }) {
  return (
    <div className="filter-bar">
      <div className="filter-bar__controls">{props.children}</div>
      {props.summary ? <div className="filter-bar__summary">{props.summary}</div> : null}
    </div>
  );
}

export function LoadingHint(props: { label?: string }) {
  return (
    <span className="loading-hint" aria-live="polite">
      <Loader2 size={15} aria-hidden="true" />
      {props.label ?? "请求提交中"}
    </span>
  );
}
