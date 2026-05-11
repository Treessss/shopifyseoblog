import { Worker, type WorkerOptions } from "bullmq";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BLOG_GENERATION_JOB_NAMES,
  QUEUE_NAMES,
  SHOPIFY_SYNC_JOB_NAMES,
  WORKER_QUEUE_PREFIX,
  closeQueues,
  getRedisConnection,
  type BlogGenerationJobName,
  type BlogGenerationQueueJobData,
  type ShopifySyncJobData,
  type ShopifySyncJobName,
  type WorkerJobData,
  type WorkerJobName,
  type WorkerJobResult
} from "./queues";
import { processBlogGenerationJob } from "./processors/blog-generation";
import { processShopifySyncJob } from "./processors/shopify-sync";

export interface StartWorkerOptions {
  shopifySyncConcurrency?: number;
  blogGenerationConcurrency?: number;
}

type RunningWorker = Worker<WorkerJobData, WorkerJobResult, WorkerJobName>;

const runningWorkers: RunningWorker[] = [];
let keepAliveTimer: NodeJS.Timeout | undefined;

export function startWorkers(options: StartWorkerOptions = {}): RunningWorker[] {
  if (runningWorkers.length > 0) return runningWorkers;

  const connection = getRedisConnection();
  const baseOptions: Pick<WorkerOptions, "connection" | "prefix"> = {
    connection,
    prefix: WORKER_QUEUE_PREFIX
  };

  const shopifySyncWorker = new Worker<ShopifySyncJobData, WorkerJobResult, ShopifySyncJobName>(
    QUEUE_NAMES.shopifySync,
    processShopifySyncJob,
    {
      ...baseOptions,
      concurrency: options.shopifySyncConcurrency ?? getConcurrency("SHOPIFY_SYNC_CONCURRENCY", 5)
    }
  );

  const blogGenerationWorker = new Worker<
    BlogGenerationQueueJobData,
    WorkerJobResult,
    BlogGenerationJobName
  >(QUEUE_NAMES.blogGeneration, processBlogGenerationJob, {
    ...baseOptions,
    concurrency: options.blogGenerationConcurrency ?? getConcurrency("BLOG_GENERATION_CONCURRENCY", 2)
  });

  attachWorkerLogging(shopifySyncWorker as RunningWorker);
  attachWorkerLogging(blogGenerationWorker as RunningWorker);

  runningWorkers.push(shopifySyncWorker as RunningWorker, blogGenerationWorker as RunningWorker);

  return runningWorkers;
}

export async function stopWorkers(): Promise<void> {
  stopKeepAlive();
  const workers = runningWorkers.splice(0, runningWorkers.length);
  await Promise.all(workers.map((worker) => worker.close()));
  await closeQueues();
}

function attachWorkerLogging(worker: RunningWorker): void {
  worker.on("completed", (job, result) => {
    console.info(
      `[worker] completed queue=${worker.name} job=${job.name} id=${job.id ?? "unknown"} ok=${result.ok}`
    );
  });

  worker.on("failed", (job, error) => {
    console.error(
      `[worker] failed queue=${worker.name} job=${job?.name ?? "unknown"} id=${job?.id ?? "unknown"}`,
      error
    );
  });

  worker.on("error", (error) => {
    console.error(`[worker] error queue=${worker.name}`, error);
  });
}

function getConcurrency(envName: string, fallback: number): number {
  const rawValue = process.env[envName];
  if (!rawValue) return fallback;

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isDirectRun(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href : false;
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.info(`[worker] received ${signal}; shutting down`);
  await stopWorkers();
}

if (isDirectRun()) {
  startWorkers();
  keepProcessAlive();
  console.info(
    `[worker] listening queues=${QUEUE_NAMES.shopifySync}:${Object.values(SHOPIFY_SYNC_JOB_NAMES).join(
      ","
    )} ${QUEUE_NAMES.blogGeneration}:${Object.values(BLOG_GENERATION_JOB_NAMES).join(",")}`
  );

  process.once("SIGINT", (signal) => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("[worker] shutdown failed", error);
        process.exit(1);
      });
  });

  process.once("SIGTERM", (signal) => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("[worker] shutdown failed", error);
        process.exit(1);
      });
  });
}

function keepProcessAlive(): void {
  keepAliveTimer ??= setInterval(() => undefined, 60_000);
}

function stopKeepAlive(): void {
  if (!keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = undefined;
}

export * from "./queues";
export * from "./processors/blog-generation";
export * from "./processors/shopify-sync";
