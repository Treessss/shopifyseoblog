export const ARTICLE_STATUSES = [
  "draft",
  "quality_failed",
  "ready_to_publish",
  "publishing",
  "published",
  "failed"
] as const;

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed", "failed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PUBLISH_POLICIES = ["auto_when_qualified", "manual_review", "direct"] as const;
export type PublishPolicy = (typeof PUBLISH_POLICIES)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "retrying"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function canPublish(status: ArticleStatus): boolean {
  return status === "ready_to_publish";
}
