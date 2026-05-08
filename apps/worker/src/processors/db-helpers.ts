import type { Job } from "bullmq";
import { prisma } from "@shopify-ai-blog/db";
import type { QueueName, WorkerJobName } from "../queues";

export interface OperationalContext {
  organizationId: string;
  storeId?: string;
  jobId?: string;
  articleId?: string;
}

export function externalJobId(
  queue: QueueName,
  jobName: WorkerJobName,
  job: Pick<Job, "id">
): string | undefined {
  return job.id ? `bullmq:${queue}:${jobName}:${job.id}` : undefined;
}

export async function startPublishJob(input: {
  organizationId: string;
  storeId: string;
  type: "generate_article" | "publish_article" | "sync_product" | "sync_collection";
  externalJobId?: string;
  articleId?: string;
  payload?: Record<string, unknown>;
}) {
  const baseData = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    articleId: input.articleId,
    type: input.type,
    status: "running" as const,
    lockedAt: new Date(),
    payload: sanitizeJsonObject(input.payload),
    errorMessage: null
  };

  if (!input.externalJobId) {
    return prisma.publishJob.create({
      data: {
        ...baseData,
        attempts: 1
      }
    });
  }

  return prisma.publishJob.upsert({
    where: { externalJobId: input.externalJobId },
    update: {
      ...baseData,
      attempts: {
        increment: 1
      }
    },
    create: {
      ...baseData,
      attempts: 1,
      externalJobId: input.externalJobId
    }
  });
}

export async function completePublishJob(jobId: string, payload?: Record<string, unknown>) {
  return prisma.publishJob.update({
    where: { id: jobId },
    data: {
      status: "succeeded",
      lockedAt: null,
      errorMessage: null,
      payload: sanitizeJsonObject(payload)
    }
  });
}

export async function failPublishJob(jobId: string, errorMessage: string, payload?: Record<string, unknown>) {
  return prisma.publishJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      lockedAt: null,
      errorMessage,
      payload: sanitizeJsonObject(payload)
    }
  });
}

export async function writePublishLog(input: OperationalContext & {
  event: "queued" | "started" | "succeeded" | "failed" | "skipped" | "retry_scheduled";
  level?: "debug" | "info" | "warn" | "error";
  message: string;
  payload?: Record<string, unknown>;
}) {
  return prisma.publishLog.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      jobId: input.jobId,
      articleId: input.articleId,
      event: input.event,
      level: input.level ?? "info",
      message: input.message,
      payload: sanitizeJsonObject(input.payload)
    }
  });
}

export async function writeAuditLog(input: OperationalContext & {
  action: "generate" | "publish" | "sync";
  entityType: string;
  entityId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: sanitizeJsonObject(input.metadata)
    }
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeJsonObject(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  return JSON.parse(
    JSON.stringify(input, (_key, value) => (value === undefined ? null : value))
  ) as Record<string, unknown>;
}
