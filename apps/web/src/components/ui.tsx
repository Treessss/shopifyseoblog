import type { ReactNode } from "react";

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

export function MetricCard(props: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <article className={`metric-card metric-card--${props.tone ?? "neutral"}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </article>
  );
}

export function Panel(props: { title?: string; description?: string; children: ReactNode; compact?: boolean }) {
  return (
    <section className={`panel${props.compact ? " panel--compact" : ""}`}>
      {props.title || props.description ? (
        <div className="panel__header">
          {props.title ? <h2>{props.title}</h2> : null}
          {props.description ? <p>{props.description}</p> : null}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

export function Badge(props: { children: ReactNode; tone?: "good" | "warn" | "danger" | "neutral" }) {
  return <span className={`badge badge--${props.tone ?? "neutral"}`}>{props.children}</span>;
}

export function ProgressBar(props: { value: number }) {
  return (
    <div className="progress" aria-label={`进度 ${props.value}%`}>
      <span style={{ width: `${Math.max(0, Math.min(100, props.value))}%` }} />
    </div>
  );
}

export function Field(props: { label: string; value: string; hint?: string; type?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type={props.type ?? "text"} defaultValue={props.value} />
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}

export function TextAreaField(props: { label: string; value: string; hint?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea defaultValue={props.value} rows={5} />
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}
