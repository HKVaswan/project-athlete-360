/**
 * src/workers/queue.factory.ts
 * --------------------------------------------------------------------------
 * 🚀 Enterprise Queue Factory — Project Athlete 360
 *
 * Features:
 *  - Manages BullMQ queues with OpenTelemetry tracing and Prometheus metrics.
 *  - Unified Redis connection pool with auto-reconnect and exponential backoff.
 *  - Structured JSON logging with trace correlation (traceId + requestId).
 *  - Built-in job retry, error recording, and runtime health monitoring.
 *  - Graceful shutdown for distributed environments (K8s / PM2 / ECS).
 * --------------------------------------------------------------------------
 */

import { Queue, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../logger";
import { config } from "../config";
import { WorkerJobPayload } from "./worker.types";
import { recordWorkerJob, recordError } from "../lib/core/metrics";
import { trace, SpanStatusCode } from "@opentelemetry/api";

/* --------------------------------------------------------------------------
 * ⚙️ Redis Connection (Shared and Observable)
 * ------------------------------------------------------------------------ */
export const redis = new IORedis(config.redisUrl || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  reconnectOnError: (err) => {
    logger.warn("[QUEUE] Redis reconnecting due to error", { error: err.message });
    return true;
  },
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    logger.warn(`[QUEUE] Redis reconnect attempt #${times} (delay: ${delay}ms)`);
    return delay;
  },
  lazyConnect: true,
});

redis.on("connect", () => {
  logger.info("[QUEUE] ✅ Redis connected for BullMQ queues");
});

redis.on("error", (err) => {
  recordError("redis_connection_failure", "high");
  logger.error("[QUEUE] ❌ Redis connection failure", { error: err.message });
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
 * 🧩 Default Job Options
 * ------------------------------------------------------------------------ */
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: 100,
  removeOnFail: 200,
  timeout: 10 * 60 * 1000, // 10 minutes
  priority: 1,
};

/* --------------------------------------------------------------------------
 * 🏗️ Queue Creation with Observability Hooks
 * ------------------------------------------------------------------------ */
export const createQueue = (name: QueueName): Queue => {
  if (queues[name]) return queues[name];

  const queue = new Queue(name, {
    connection: redis,
    prefix: `{pa360}:${name}`,
    defaultJobOptions,
  });

  queue.on("error", (err) => {
    recordError(`queue_${name}_error`, "high");
    logger.error(`[QUEUE:${name}] ❌ Queue runtime error`, { error: err.message });
  });

  queue.on("waiting", () => logger.debug(`[QUEUE:${name}] Waiting for jobs...`));
  queue.on("active", () => logger.debug(`[QUEUE:${name}] Job active`));
  queue.on("completed", (job) => {
    recordWorkerJob(name, 1, "success");
    logger.info(`[QUEUE:${name}] ✅ Job completed: ${job.id}`);
  });
  queue.on("failed", (job, err) => {
    recordWorkerJob(name, 1, "failed");
    recordError(`job_${name}_failed`, "medium");
    logger.warn(`[QUEUE:${name}] ⚠️ Job failed: ${job?.id}`, { error: err.message });
  });

  queues[name] = queue;
  logger.info(`[QUEUE] ✅ Queue initialized: ${name}`);

  return queue;
};

/* --------------------------------------------------------------------------
 * 📥 Job Enqueue (with Tracing)
 * ------------------------------------------------------------------------ */
export const enqueueJob = async <T extends WorkerJobPayload>(
  queueName: QueueName,
  jobName: string,
  data: T,
  options?: JobsOptions
) => {
  const tracer = trace.getTracer("pa360.queue");
  const span = tracer.startSpan(`enqueue.${queueName}`, {
    attributes: { "queue.name": queueName, "job.name": jobName },
  });

  try {
    const queue = queues[queueName] || createQueue(queueName);
    const job = await queue.add(jobName, data, { ...defaultJobOptions, ...options });

    span.addEvent("job_enqueued", { queue: queueName, jobId: job.id });
    span.setStatus({ code: SpanStatusCode.OK });
    logger.info(`[QUEUE:${queueName}] 📥 Enqueued job '${jobName}' (ID: ${job.id})`, {
      traceId: span.spanContext().traceId,
    });

    return job;
  } catch (err: any) {
    recordError(`enqueue_${queueName}_failed`, "high");
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error(`[QUEUE:${queueName}] ❌ Failed to enqueue job '${jobName}'`, {
      error: err.message,
    });
    throw err;
  } finally {
    span.end();
  }
};

/* --------------------------------------------------------------------------
 * 🧹 Maintenance Utilities
 * ------------------------------------------------------------------------ */
export const purgeQueue = async (queueName: QueueName) => {
  try {
    const queue = queues[queueName] || createQueue(queueName);
    await queue.drain(true);
    logger.warn(`[QUEUE:${queueName}] 🧹 Queue drained successfully`);
  } catch (err: any) {
    recordError(`purge_${queueName}_failed`, "medium");
    logger.error(`[QUEUE:${queueName}] ❌ Failed to purge queue`, { error: err.message });
  }
};

/* --------------------------------------------------------------------------
 * 🌡️ Health & Stats Inspection
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
  logger.info("[QUEUE] 📴 Initiating graceful queue shutdown...");

  for (const [name, queue] of Object.entries(queues)) {
    try {
      await queue.close();
      logger.info(`[QUEUE] Closed queue: ${name}`);
    } catch (err: any) {
      logger.error(`[QUEUE] Error closing queue '${name}'`, { error: err.message });
    }
  }

  try {
    await redis.quit();
    logger.info("[QUEUE] Redis connection closed gracefully.");
  } catch (err: any) {
    logger.error("[QUEUE] Redis shutdown error", { error: err.message });
  }
};

/* --------------------------------------------------------------------------
 * 📊 Runtime Metrics Updater
 * ------------------------------------------------------------------------ */
setInterval(async () => {
  try {
    for (const [name, queue] of Object.entries(queues)) {
      const [active, waiting, failed, delayed] = await Promise.all([
        queue.getActiveCount(),
        queue.getWaitingCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      const total = active + waiting + delayed;
      recordWorkerJob(name, total, failed > 0 ? "failed" : "success");

      logger.debug(`[QUEUE:${name}] Metrics updated`, { active, waiting, failed, delayed });
    }
  } catch (err: any) {
    logger.debug(`[QUEUE] Metrics collection skipped`, { error: err.message });
  }
}, 60_000).unref();

/* --------------------------------------------------------------------------
 * 🧩 Export Registry
 * ------------------------------------------------------------------------ */
export { queues };