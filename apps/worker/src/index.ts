import { Worker, type WorkerOptions } from "bullmq";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BLOG_GENERATION_JOB_NAMES,
  QUEUE_NAMES,
  SEARCH_CONSOLE_JOB_NAMES,
  SHOPIFY_SYNC_JOB_NAMES,
  WORKER_QUEUE_PREFIX,
  enqueueSearchConsoleStoreSync,
  closeQueues,
  getRedisConnection,
  type BlogGenerationJobName,
  type BlogGenerationQueueJobData,
  type SearchConsoleJobName,
  type SearchConsoleQueueJobData,
  type ShopifySyncJobData,
  type ShopifySyncJobName,
  type WorkerJobData,
  type WorkerJobName,
  type WorkerJobResult
} from "./queues";
import { processBlogGenerationJob } from "./processors/blog-generation";
import { processSearchConsoleJob } from "./processors/search-console";
import { processShopifySyncJob } from "./processors/shopify-sync";
import { prisma } from "@shopify-ai-blog/db";
import { parseIntegerEnv } from "./processors/shared";

export interface StartWorkerOptions {
  shopifySyncConcurrency?: number;
  blogGenerationConcurrency?: number;
  seoPerformanceConcurrency?: number;
  scheduleSearchConsoleSync?: boolean;
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

  const seoPerformanceWorker = new Worker<
    SearchConsoleQueueJobData,
    WorkerJobResult,
    SearchConsoleJobName
  >(QUEUE_NAMES.seoPerformance, processSearchConsoleJob, {
    ...baseOptions,
    concurrency: options.seoPerformanceConcurrency ?? getConcurrency("SEO_PERFORMANCE_CONCURRENCY", 1)
  });

  attachWorkerLogging(shopifySyncWorker as RunningWorker);
  attachWorkerLogging(blogGenerationWorker as RunningWorker);
  attachWorkerLogging(seoPerformanceWorker as RunningWorker);

  runningWorkers.push(shopifySyncWorker as RunningWorker, blogGenerationWorker as RunningWorker, seoPerformanceWorker as RunningWorker);

  if (options.scheduleSearchConsoleSync !== false) {
    void scheduleSearchConsoleSyncJobs().catch((error) => {
      console.error("[worker] failed to schedule Search Console sync jobs", error);
    });
  }

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
    )} ${QUEUE_NAMES.blogGeneration}:${Object.values(BLOG_GENERATION_JOB_NAMES).join(",")} ${QUEUE_NAMES.seoPerformance}:${Object.values(
      SEARCH_CONSOLE_JOB_NAMES
    ).join(",")}`
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

async function scheduleSearchConsoleSyncJobs(): Promise<void> {
  const properties = await prisma.searchConsoleProperty.findMany({
    where: { status: "active" },
    select: {
      id: true,
      organizationId: true,
      storeId: true
    },
    take: parseIntegerEnv("GSC_SCHEDULE_MAX_PROPERTIES", 100)
  });
  const intervalMs = parseIntegerEnv("GSC_SYNC_INTERVAL_MS", 24 * 60 * 60 * 1000);

  await Promise.all(
    properties.map((property) =>
      enqueueSearchConsoleStoreSync(
        {
          organizationId: property.organizationId,
          storeId: property.storeId,
          propertyId: property.id,
          days: parseIntegerEnv("GSC_SYNC_DAYS", 28)
        },
        {
          jobId: `gsc-store-sync:${property.id}`,
          repeat: { every: intervalMs }
        }
      )
    )
  );
}

export * from "./queues";
export * from "./processors/blog-generation";
export * from "./processors/search-console";
export * from "./processors/shopify-sync";
