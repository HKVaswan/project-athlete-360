/**
 * src/workers/queue.factory.ts
 * --------------------------------------------------------------------------
 * Enterprise Queue Factory for Project Athlete 360
 * --------------------------------------------------------------------------
 * - Creates and manages BullMQ queues with observability, retries, and tracing
 * - Integrates with Prometheus metrics and OpenTelemetry tracing
 * - Provides consistent error handling and graceful shutdowns
 * - Serves as the backbone for all async background jobs
 * --------------------------------------------------------------------------
 */

import { Queue, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../logger";
import { config } from "../config";
import { WorkerJobPayload } from "./worker.types";
import { recordWorkerJob, recordError } from "../lib/core/metrics";
import { trace } from "@opentelemetry/api";

/* --------------------------------------------------------------------------
 * ⚙️ Redis Connection (Shared)
 * ------------------------------------------------------------------------ */
const redis = new IORedis(config.redisUrl || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true,
  reconnectOnError: () => true,
});

redis.on("error", (err) => {
  recordError("redis_connection_failure", "high");
  logger.error("[QUEUE] ❌ Redis connection failure:", err.message);
});

redis.on("connect", () => {
  logger.info("[QUEUE] ✅ Redis connected for BullMQ queues");
});

/* --------------------------------------------------------------------------
 * 📦 Queue Registry
 * ------------------------------------------------------------------------ */
export enum QueueName {
  EMAIL = "email",
  RESOURCE = "resourceProcessing",
  ANALYTICS = "analytics",
  AI = "aiProcessing",
  NOTIFICATION = "notification",
  BACKUP = "backup",
  RESTORE = "restore",
  REPORT = "reportGenerator",
  SESSION = "sessionReminder",
  SECURITY = "securityAudit",
  BILLING = "billing",
  TELEMETRY = "telemetry",
}

const queues: Record<QueueName, Queue> = {} as any;

/* --------------------------------------------------------------------------
 * 🧩 Default Job Settings
 * ------------------------------------------------------------------------ */
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: 50,
  removeOnFail: 100,
  timeout: 1000 * 60 * 10, // 10 min
  priority: 1,
};

/* --------------------------------------------------------------------------
 * 🏗️ Queue Creation
 * ------------------------------------------------------------------------ */
export const createQueue = (name: QueueName): Queue => {
  if (queues[name]) return queues[name];

  const queue = new Queue(name, {
    connection: redis,
    prefix: `{pa360}:${name}`,
    defaultJobOptions,
  });

  queues[name] = queue;
  logger.info(`[QUEUE] ✅ Queue initialized: ${name}`);

  return queue;
};

/* --------------------------------------------------------------------------
 * 🧠 Job Enqueue Helper
 * ------------------------------------------------------------------------ */
export const enqueueJob = async <T extends WorkerJobPayload>(
  queueName: QueueName,
  jobName: string,
  data: T,
  options?: JobsOptions
) => {
  const span = trace.getTracer("pa360-queue").startSpan(`enqueue.${queueName}`);

  try {
    const queue = queues[queueName] || createQueue(queueName);
    const job = await queue.add(jobName, data, { ...defaultJobOptions, ...options });
    logger.info(`[QUEUE:${queueName}] 📥 Enqueued job '${jobName}' (ID: ${job.id})`);

    span.addEvent("job_enqueued", { queueName, jobId: job.id });
    return job;
  } catch (err: any) {
    recordError(`enqueue_${queueName}_failed`, "high");
    span.recordException(err);
    logger.error(`[QUEUE:${queueName}] ❌ Failed to enqueue job '${jobName}': ${err.message}`);
    throw err;
  } finally {
    span.end();
  }
};

/* --------------------------------------------------------------------------
 * 🧹 Queue Maintenance Tools
 * ------------------------------------------------------------------------ */
export const purgeQueue = async (queueName: QueueName) => {
  try {
    const queue = queues[queueName] || createQueue(queueName);
    await queue.drain(true);
    logger.warn(`[QUEUE:${queueName}] 🧹 Queue drained successfully`);
  } catch (err: any) {
    recordError(`purge_${queueName}_failed`, "medium");
    logger.error(`[QUEUE:${queueName}] ❌ Failed to purge queue: ${err.message}`);
  }
};

/* --------------------------------------------------------------------------
 * 📊 Queue Health Inspector
 * ------------------------------------------------------------------------ */
export const getQueueHealth = async () => {
  const result: Record<string, any> = {};
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const counts = await queue.getJobCounts();
      result[name] = { ...counts };
    } catch (err: any) {
      result[name] = { error: err.message };
    }
  }
  return result;
};

/* --------------------------------------------------------------------------
 * 🛑 Graceful Shutdown
 * ------------------------------------------------------------------------ */
export const shutdownQueues = async () => {
  logger.info("[QUEUE] 📴 Shutting down queues gracefully...");
  for (const [name, queue] of Object.entries(queues)) {
    try {
      await queue.close();
      logger.info(`[QUEUE] Closed queue: ${name}`);
    } catch (err: any) {
      logger.error(`[QUEUE] Error closing queue '${name}': ${err.message}`);
    }
  }

  try {
    await redis.quit();
    logger.info("[QUEUE] Redis connection closed.");
  } catch (err: any) {
    logger.error("[QUEUE] Failed to close Redis connection:", err.message);
  }
};

/* --------------------------------------------------------------------------
 * 🌡️ Runtime Metrics Updater
 * ------------------------------------------------------------------------ */
setInterval(async () => {
  try {
    for (const [name, queue] of Object.entries(queues)) {
      const active = await queue.getActiveCount();
      const waiting = await queue.getWaitingCount();
      const failed = await queue.getFailedCount();
      const total = active + waiting + failed;

      recordWorkerJob(name, total, failed > 0 ? "failed" : "success");
    }
  } catch (err: any) {
    logger.debug(`[QUEUE] Metrics update skipped: ${err.message}`);
  }
}, 60_000).unref();

/* --------------------------------------------------------------------------
 * 🧩 Export Registry
 * ------------------------------------------------------------------------ */
export { queues, redis };