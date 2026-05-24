import Link from "next/link";
import { ArrowRight, FileText, ScrollText, Sparkles, TriangleAlert } from "lucide-react";
import { Badge, Panel } from "@/components/ui";
import type { AdminCampaignView } from "@/lib/admin-client";

export function CampaignRecoveryPanel({ campaign }: { campaign: AdminCampaignView }) {
  if (!campaign.progressIsStale && !campaign.progressRecoverable) return null;

  const needsArticleRepair = Boolean(campaign.progressArticleId);
  const staleLabel =
    campaign.progressStaleReason ??
    `任务较久没有进度心跳${campaign.progressStaleMinutes !== null ? `（${campaign.progressStaleMinutes} 分钟）` : ""}。`;

  return (
    <Panel title="任务卡住时怎么继续" description="把 stalled 状态拆成一个能执行的恢复路径，而不是只显示一个红色提示。">
      <div className="list">
        <div className="list-item">
          <div>
            <strong>{campaign.name}</strong>
            <small className="muted">{staleLabel}</small>
          </div>
          <Badge tone="danger">需要处理</Badge>
        </div>

        <div className="list-item">
          <div>
            <strong>下一步先看什么</strong>
            <small className="muted">
              {campaign.progressNextStep ??
                "先看当前阶段和日志；如果已经有草稿，就进入文章页检查质量门禁并触发修复。"}
            </small>
          </div>
        </div>

        <div className="list-item">
          <div>
            <strong>推荐恢复顺序</strong>
            <small className="muted">1. 看日志 2. 打开文章 3. 继续修复 4. 再看任务进度</small>
          </div>
          <Badge tone="warn">{campaign.progressLabel}</Badge>
        </div>

        <div className="row-actions">
          <Link className="button button--small" href="/logs?q=blog-generation">
            <ScrollText size={14} aria-hidden="true" />
            看日志
          </Link>
          {campaign.progressArticleId ? (
            <Link className="button button--small" href={`/articles/${campaign.progressArticleId}`}>
              <FileText size={14} aria-hidden="true" />
              打开文章
            </Link>
          ) : null}
          {needsArticleRepair && campaign.progressArticleId ? (
            <form action={`/api/admin/articles/${campaign.progressArticleId}/repair`} method="post">
              <input type="hidden" name="repairReason" value="任务卡住：按文章当前质检、Agent 轨迹和搜索评分继续修复。" />
              <button className="button button--small" type="submit">
                <Sparkles size={14} aria-hidden="true" />
                继续修复
              </button>
            </form>
          ) : null}
          <Link className="button button--small" href="/agents">
            <ArrowRight size={14} aria-hidden="true" />
            去 Agent 中心
          </Link>
        </div>

        {campaign.progressRecoverable ? (
          <div className="list-item">
            <div>
              <strong>可恢复状态</strong>
              <small className="muted">这个任务还没丢，通常是队列等待、生成停顿或修复未继续。</small>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
