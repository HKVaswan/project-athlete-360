/**
 * src/workers/workerUtils.ts
 *
 * Enterprise-ready utilities for working with BullMQ queues & jobs.
 * - Provides safe queue creation/lookup using the central connection in workers/index.ts
 * - Helpers to add jobs with sensible defaults (removeOnComplete, backoff, attempts)
 * - Unique job + idempotency helpers (avoid duplicate jobs)
 * - Scheduling helpers (delayed jobs)
 * - Helpers to wait for job completion (useful in tests or sync flows)
 * - Standardized error serialization for logs/alarms
 *
 * Note: This file expects workers/index.ts to export `queues` object and that
 * a shared Redis connection is used by BullMQ. Keep job payloads small and serializable.
 */

import { Queue, JobOptions, Job, QueueEvents } from "bullmq";
import ms from "ms";
import { v4 as uuidv4 } from "uuid";
import { queues } from "./index";
import { logger } from "../logger";
import { config } from "../config";

export const DEFAULT_QUEUE_NAME = "default";

/**
 * Default job options used across the system.
 * - attempts: retry attempts
 * - backoff: exponential backoff with base delay
 * - removeOnComplete / removeOnFail: keep Redis clean
 */
export const DEFAULT_JOB_OPTS: JobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 3000 }, // 3s initial, exponential
  removeOnComplete: { age: 60 * 60, count: 1000 }, // keep last 1000 or 1 hour
  removeOnFail: { age: 60 * 60 * 24, count: 100 }, // keep failures for 24h
  timeout: ms("30s"),
};

/**
 * Resolve or create a queue instance by name.
 * Registered queues from workers/index.ts are preferred.
 * If not present, create a thin Queue wrapper around existing Redis connection.
 */
export const getQueue = (name = DEFAULT_QUEUE_NAME): Queue => {
  if (queues[name]) return queues[name];
  // Lazily create a BullMQ Queue if not already registered.
  // Importing Queue here prevents circular dependency issues with workers/index.ts
  const { Queue: _Queue } = require("bullmq");
  const connection = require("ioredis").default
    ? undefined
    : undefined; // intentionally no-op; the registerWorker path should be used in prod.

  // Best-effort: create local queue with default connection (uses env REDIS_URL)
  const q = new _Queue(name);
  queues[name] = q;
  logger.warn(`[workerUtils] Created ad-hoc queue '${name}' (not registered in workers/index).`);
  return q;
};

/**
 * Add a job to the queue with defaults.
 * - jobName: logical name (grouping)
 * - data: job payload (must be serializable)
 * - opts: JobOptions overrides
 */
export const addJob = async (
  queueName: string,
  jobName: string,
  data: any,
  opts?: Partial<JobOptions>
): Promise<Job | null> => {
  try {
    const queue = getQueue(queueName);
    const jobId = (opts as any)?.jobId ?? uuidv4();
    const job = await queue.add(jobName, data, { ...DEFAULT_JOB_OPTS, ...opts, jobId });
    logger.debug(`[workerUtils] Added job ${job.id} (${queueName}:${jobName})`);
    return job;
  } catch (err: any) {
    logger.error(`[workerUtils] Failed to add job ${queueName}:${jobName} - ${err.message}`);
    return null;
  }
};

/**
 * Add a unique job (idempotent) — if a job with same jobId exists, return that job.
 * Useful for deduping scheduled tasks (e.g., reminders).
 */
export const addUniqueJob = async (
  queueName: string,
  jobName: string,
  jobId: string,
  data: any,
  opts?: Partial<JobOptions>
): Promise<Job | null> => {
  try {
    const queue = getQueue(queueName);

    // If the job already exists, return it
    const existing = await queue.getJob(jobId);
    if (existing) {
      logger.debug(`[workerUtils] Unique job exists: ${jobId} (${queueName}:${jobName})`);
      return existing;
    }

    const job = await queue.add(jobName, data, { ...DEFAULT_JOB_OPTS, ...opts, jobId });
    logger.debug(`[workerUtils] Added unique job ${job.id} (${queueName}:${jobName})`);
    return job;
  } catch (err: any) {
    logger.error(
      `[workerUtils] Failed to add unique job ${queueName}:${jobName} (jobId=${jobId}) - ${err.message}`
    );
    return null;
  }
};

/**
 * Schedule a delayed job (in ms or human string)
 * - delay can be number (ms) or string (e.g., "2h", "30m")
 */
export const scheduleJob = async (
  queueName: string,
  jobName: string,
  data: any,
  delay: number | string,
  opts?: Partial<JobOptions>
): Promise<Job | null> => {
  try {
    const delayMs = typeof delay === "string" ? ms(delay) : Number(delay);
    if (!isFinite(delayMs) || delayMs < 0) throw new Error("Invalid delay");

    const job = await addJob(queueName, jobName, data, { delay: delayMs, ...opts });
    logger.info(
      `[workerUtils] Scheduled job ${job?.id ?? "unknown"} on ${queueName}:${jobName} after ${delayMs}ms`
    );
    return job;
  } catch (err: any) {
    logger.error(`[workerUtils] Failed to schedule job ${queueName}:${jobName} - ${err.message}`);
    return null;
  }
};

/**
 * Wait for job completion by job id.
 * Useful in tests or when synchronous flow is required.
 * - timeout: ms before rejecting
 */
export const waitForJobCompletion = async (queueName: string, jobId: string, timeout = ms("30s")): Promise<any> => {
  const queue = getQueue(queueName);
  const events = new QueueEvents(queueName, { connection: (queue as any).client?.options });
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      events.close().catch(() => {});
      reject(new Error("waitForJobCompletion: timeout"));
    }, timeout);

    events.on("completed", async (args: any) => {
      try {
        if (args.jobId === jobId) {
          clearTimeout(to);
          events.close().catch(() => {});
          const job = await queue.getJob(jobId);
          resolve(job?.returnvalue ?? null);
        }
      } catch (err) {
        clearTimeout(to);
        events.close().catch(() => {});
        reject(err);
      }
    });

    events.on("failed", (args: any) => {
      if (args.jobId === jobId) {
        clearTimeout(to);
        events.close().catch(() => {});
        reject(new Error(`Job failed: ${JSON.stringify(args)}`));
      }
    });
  });
};

/**
 * Standardized error serialization for jobs so logs & monitoring are consistent.
 */
export const serializeError = (err: any) => {
  if (!err) return { message: "Unknown error" };
  const safe: any = {
    message: err.message || String(err),
    name: err.name || "Error",
  };
  if (err.stack) safe.stack = err.stack;
  // include code (Prisma / HTTP / custom)
  if (err.code) safe.code = err.code;
  if (err.statusCode) safe.status = err.statusCode;
  // include any structured details if present
  if (err.details) safe.details = err.details;
  return safe;
};

/**
 * Simple wrapper to create a processor that auto catches errors and rethrows
 * with standardized logging. Use this inside worker file default export:
 *
 * export default processorWrapper(async (job) => { ... });
 */
export const processorWrapper = (fn: (job: any) => Promise<any>) => {
  return async (job: any) => {
    try {
      const result = await fn(job);
      return result;
    } catch (err: any) {
      const payload = { queue: job?.queueName ?? "unknown", id: job?.id ?? "unknown", name: job?.name ?? "" };
      logger.error(`[workerUtils.processorWrapper] Job failed ${JSON.stringify(payload)} - ${err?.message}`);
      // Attach serialized error to job for easier inspection in UI/monitoring
      throw Object.assign(new Error(err?.message ?? "Job error"), { meta: serializeError(err) });
    }
  };
};

/**
 * Convenience helper: add job and wait for completion (safe wrapper)
 */
export const addJobAndWait = async (
  queueName: string,
  jobName: string,
  data: any,
  opts?: Partial<JobOptions>,
  waitTimeout = ms("30s")
) => {
  const job = await addJob(queueName, jobName, data, opts);
  if (!job) throw new Error("Failed to enqueue job");
  return waitForJobCompletion(queueName, job.id, waitTimeout);
};

/**
 * Safe noop for graceful shutdown of workers/queues.
 * Attempt to close queues registered in workers/index.ts if available.
 */
export const shutdownAllQueues = async () => {
  const closePromises: Promise<any>[] = [];
  Object.keys(queues).forEach((name) => {
    try {
      closePromises.push(queues[name].close());
    } catch (err: any) {
      logger.warn(`[workerUtils] Failed to close queue ${name}: ${err.message}`);
    }
  });
  await Promise.allSettled(closePromises);
  logger.info("[workerUtils] All known queues closed (best-effort).");
};

export default {
  getQueue,
  addJob,
  addUniqueJob,
  scheduleJob,
  waitForJobCompletion,
  processorWrapper,
  serializeError,
  addJobAndWait,
  shutdownAllQueues,
};