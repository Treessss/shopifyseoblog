"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ScrollText, Sparkles, TriangleAlert } from "lucide-react";
import { Badge, ProgressBar, TableEmpty } from "@/components/ui";
import type { AdminCampaignView } from "@/lib/admin-client";

type CampaignProgressTableProps = {
  initialCampaigns: AdminCampaignView[];
  query: string;
  status: string;
};

export function CampaignProgressTable({ initialCampaigns, query, status }: CampaignProgressTableProps) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setCampaigns(initialCampaigns);
  }, [initialCampaigns]);

  useEffect(() => {
    let alive = true;

    async function refreshCampaigns() {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const response = await fetch("/api/admin/campaigns", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) return;
        const payload = (await response.json()) as unknown;
        const nextCampaigns = readCampaigns(payload);
        if (alive && nextCampaigns.length > 0) {
          setCampaigns(nextCampaigns);
          setLastRefresh(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    const interval = window.setInterval(refreshCampaigns, 2500);
    void refreshCampaigns();

    return () => {
      alive = false;
      window.clearInterval(interval);
      requestRef.current?.abort();
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((campaign) => {
      const matchesQuery =
        !normalizedQuery ||
        `${campaign.name} ${campaign.store} ${campaign.source} ${campaign.primaryKeyword ?? ""}`.toLowerCase().includes(normalizedQuery);
      const matchesStatus = !status || campaign.status === status;
      return matchesQuery && matchesStatus;
    });
  }, [campaigns, normalizedQuery, status]);

  return (
    <>
      <div className="table-live-status" aria-live="polite">
        <span>生成阶段自动刷新</span>
        {lastRefresh ? <strong>最后更新 {lastRefresh}</strong> : <strong>等待任务状态</strong>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>任务</th>
              <th>店铺</th>
              <th>来源</th>
              <th>语言</th>
              <th>进度</th>
              <th>发布策略</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {filteredCampaigns.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title={campaigns.length === 0 ? "暂无内容任务" : "没有匹配的任务"}
                description={campaigns.length === 0 ? "新建任务后，worker 生成进度和发布策略会显示在这里。" : "调整搜索关键词或状态筛选条件。"}
              />
            ) : (
              filteredCampaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <strong>{campaign.name}</strong>
                    {campaign.primaryKeyword ? <div className="muted">关键词：{campaign.primaryKeyword}</div> : null}
                  </td>
                  <td>{campaign.store}</td>
                  <td>{campaign.source}</td>
                  <td className="code">{campaign.locale}</td>
                  <td>
                    <div className="progress-cell progress-cell--stacked">
                      <div>
                        <ProgressBar value={campaign.progress} />
                        <span>{campaign.progress}%</span>
                      </div>
                      <small>
                        {campaign.progressStage ? `${campaign.progressStage} · ` : ""}
                        {campaign.progressLabel}
                      </small>
                      {campaign.progressDetail ? <em>{campaign.progressDetail}</em> : null}
                      {campaign.progressNextStep ? <em>下一步：{campaign.progressNextStep}</em> : null}
                      {campaign.progressIsStale ? (
                        <div className="progress-alert" role="status">
                          <TriangleAlert size={14} aria-hidden="true" />
                          <span>
                            {campaign.progressStaleReason ??
                              `任务较久没有进度心跳${campaign.progressStaleMinutes !== null ? `（${campaign.progressStaleMinutes} 分钟）` : ""}。先看日志，如果草稿已生成就去文章页修复。`}
                          </span>
                        </div>
                      ) : campaign.progressRecoverable ? (
                        <Badge tone="warn">可重试/可修复</Badge>
                      ) : null}
                      {campaign.progressIsStale ? (
                        <div className="progress-actions">
                          <Link className="button button--small" href="/logs?q=blog-generation">
                            <ScrollText size={14} aria-hidden="true" />
                            日志
                          </Link>
                          {campaign.progressArticleId ? (
                            <Link className="button button--small" href={`/articles/${campaign.progressArticleId}`}>
                              <FileText size={14} aria-hidden="true" />
                              文章
                            </Link>
                          ) : null}
                          {campaign.progressArticleId ? (
                            <form action={`/api/admin/articles/${campaign.progressArticleId}/repair`} method="post">
                              <input type="hidden" name="repairReason" value="任务长时间没有进度心跳：按当前草稿、质检状态和 Agent 轨迹继续修复。" />
                              <button className="button button--small" type="submit">
                                <Sparkles size={14} aria-hidden="true" />
                                继续修复
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td>{campaign.publishPolicy}</td>
                  <td>
                    <Badge tone={campaign.statusTone}>{formatCampaignStatus(campaign.status)}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function readCampaigns(payload: unknown): AdminCampaignView[] {
  const record = asRecord(payload);
  const data = asRecord(record.data);
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : Array.isArray(record.campaigns) ? record.campaigns : [];
  return campaigns.map((campaign, index) => normalizeCampaign(campaign, index));
}

function normalizeCampaign(input: unknown, index: number): AdminCampaignView {
  const record = asRecord(input);
  const status = stringValue(record.status, "draft");
  return {
    id: stringValue(record.id ?? record.campaignId, `campaign-${index}`),
    name: stringValue(record.name ?? record.title, "未命名任务"),
    store: stringValue(record.storeName ?? record.store, "未绑定店铺"),
    locale: stringValue(record.locale, "zh-CN"),
    source: stringValue(record.source, "Manual topics"),
    status,
    statusTone: campaignTone(status),
    progress: clampPercent(numberValue(record.progress ?? record.progressPercent, 0)),
    progressLabel: stringValue(record.progressLabel ?? record.stageLabel, status === "active" ? "正在执行" : "未开始"),
    progressStep: nullableString(record.progressStep ?? record.stage),
    progressDetail: nullableString(record.progressDetail ?? record.detail),
    progressUpdatedAt: nullableString(record.progressUpdatedAt),
    progressStage: nullableString(record.progressStage),
    progressNextStep: nullableString(record.progressNextStep),
    progressRecoverable: Boolean(record.progressRecoverable),
    progressArticleId: nullableString(record.progressArticleId),
    progressIsStale: Boolean(record.progressIsStale),
    progressStaleMinutes: nullableNumber(record.progressStaleMinutes),
    progressStaleReason: nullableString(record.progressStaleReason),
    publishPolicy: stringValue(record.publishPolicy, "人工复核"),
    targetWordCount: numberValue(record.targetWordCount, 0),
    primaryKeyword: stringValue(record.primaryKeyword, "")
  };
}

function formatCampaignStatus(status: string) {
  switch (status) {
    case "active":
      return "进行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "paused":
      return "已暂停";
    default:
      return "草稿";
  }
}

function campaignTone(status: string): AdminCampaignView["statusTone"] {
  if (status === "completed") return "good";
  if (status === "failed") return "danger";
  if (status === "active") return "warn";
  return "neutral";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
