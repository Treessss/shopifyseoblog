import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";
import { Badge, Panel, StatusPill } from "@/components/ui";

export interface StartPathPanelProps {
  title: string;
  description: string;
  primaryLabel: string;
  primaryHref: string;
  steps: Array<{
    index: string;
    title: string;
    detail: string;
  }>;
  statusLabel: string;
  statusValue: string;
  statusTone: "good" | "warn" | "danger" | "neutral";
  statusHint: string;
  badgeLabel?: string;
}

export function StartPathPanel({
  title,
  description,
  primaryLabel,
  primaryHref,
  steps,
  statusLabel,
  statusValue,
  statusTone,
  statusHint,
  badgeLabel
}: StartPathPanelProps) {
  return (
    <Panel
      title={title}
      description={description}
      action={
        <Link href={primaryHref} className="button button--primary">
          <PlayCircle size={16} aria-hidden="true" />
          {primaryLabel}
        </Link>
      }
    >
      <div className="dashboard-hero">
        <div className="dashboard-hero__main">
          <h2>{steps.length > 0 ? `${steps[0].index}. ${steps[0].title}` : title}</h2>
          <p>{statusHint}</p>
          <div className="hero-path__steps">
            {steps.map((step) => (
              <div className="hero-path__step" key={`${step.index}-${step.title}`}>
                <strong>{step.index}</strong>
                <div>
                  <span>{step.title}</span>
                  <small className="muted">{step.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-hero__aside">
          <StatusPill label={statusLabel} value={statusValue} tone={statusTone} icon={<ArrowRight size={18} aria-hidden="true" />} />
          {badgeLabel ? <Badge tone={statusTone}>{badgeLabel}</Badge> : null}
        </div>
      </div>
    </Panel>
  );
}
