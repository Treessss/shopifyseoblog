import { Activity, RefreshCw } from "lucide-react";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { logs } from "@/lib/admin-data";

export default function LogsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Logs"
        title="运行日志"
        description="追踪内容生成、Shopify 同步、发布和 webhook 处理事件。"
        action={
          <button className="button">
            <RefreshCw size={16} aria-hidden="true" />
            刷新日志
          </button>
        }
      />

      <Panel title="最近事件" description="正式接入后可按组织、店铺、任务 ID 和严重级别过滤。">
        {logs.map((log) => (
          <div className="log-line" key={`${log.time}-${log.message}`}>
            <span className="code">{log.time}</span>
            <Badge tone={log.level === "error" ? "danger" : log.level === "warning" ? "warn" : "good"}>{log.level}</Badge>
            <span className="code">{log.module}</span>
            <span>{log.message}</span>
            <Badge tone={log.status === "failed" ? "danger" : log.status === "retrying" ? "warn" : "good"}>
              {log.status}
            </Badge>
          </div>
        ))}
      </Panel>

      <Panel compact>
        <div className="list-item" style={{ marginTop: 16 }}>
          <Activity size={18} aria-hidden="true" />
          <div>
          <strong>告警策略</strong>
          <small className="muted">失败发布、授权过期和同步延迟会进入待处理队列。</small>
          </div>
        </div>
      </Panel>
    </>
  );
}
