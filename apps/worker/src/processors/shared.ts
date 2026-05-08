import { UnrecoverableError, type Job } from "bullmq";
import type { Prisma } from "@shopify-ai-blog/db";
export class WorkerDomainError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(code: string, message: string, options: { retryable?: boolean; details?: unknown } = {}) {
    super(message);
    this.name = "WorkerDomainError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function domainError(
  code: string,
  message: string,
  options: { retryable?: boolean; details?: unknown } = {}
): WorkerDomainError {
  return new WorkerDomainError(code, message, options);
}

export function isWorkerDomainError(error: unknown): error is WorkerDomainError {
  return error instanceof WorkerDomainError;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown worker error.";
}

export function getErrorCode(error: unknown): string {
  if (isWorkerDomainError(error)) return error.code;
  if (error instanceof Error && error.name) return error.name;
  return "WORKER_ERROR";
}

export function isRetryableError(error: unknown): boolean {
  return isWorkerDomainError(error) ? error.retryable : true;
}

export function willRetryJob(job: Job, error: unknown): boolean {
  if (!isRetryableError(error)) return false;
  const attempts = typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
  return job.attemptsMade + 1 < attempts;
}

export function failureJobStatus(job: Job, error: unknown): "retrying" | "failed" {
  return willRetryJob(job, error) ? "retrying" : "failed";
}

export function failurePublishEvent(job: Job, error: unknown): "retry_scheduled" | "failed" {
  return willRetryJob(job, error) ? "retry_scheduled" : "failed";
}

export function throwForBullMQ(error: unknown): never {
  if (isWorkerDomainError(error) && !error.retryable) {
    throw new UnrecoverableError(`${error.code}: ${error.message}`);
  }

  if (error instanceof Error) throw error;
  throw new Error(getErrorMessage(error));
}

export function buildExternalJobId(queueName: string, jobName: string, bullJobId: string | undefined): string | undefined {
  return bullJobId ? `${queueName}:${jobName}:${bullJobId}` : undefined;
}

export function currentAttempt(job: Job): number {
  return job.attemptsMade + 1;
}

export function maxAttempts(job: Job): number {
  return typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
}

export function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function parseIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  const sanitized = sanitizeJson(value, new WeakSet());
  return sanitized === undefined ? undefined : (sanitized as Prisma.InputJsonValue);
}

export function failurePayload(error: unknown, extra: Record<string, unknown> = {}): Prisma.InputJsonValue | undefined {
  return toPrismaJson({
    ...extra,
    code: getErrorCode(error),
    message: getErrorMessage(error),
    retryable: isRetryableError(error),
    details: isWorkerDomainError(error) ? error.details : undefined
  });
}

export function trimForDb(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function sanitizeJson(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value;
  if (type === "bigint") return value.toString();
  if (type === "symbol" || type === "function") return undefined;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item, seen) ?? null);
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const sanitized = sanitizeJson(item, seen);
      if (sanitized !== undefined) output[key] = sanitized;
    }

    seen.delete(value);
    return output;
  }

  return String(value);
}
