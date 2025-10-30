/**
 * src/workers/queue.factory.ts
 * ---------------------------------------------------------------------
 * Factory for initializing and managing BullMQ queues with consistency.
 *
 * Features:
 *  - Auto-configured retry, backoff, and rate limiting
 *  - Centralized queue registry with Redis connection pooling
 *  - Built-in health monitoring and safe job enqueuing
 *  - Supports dynamic job typing (from worker.types)
 */

import { Queue, JobsOptions, ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../logger";
import { config } from "../config";
import { WorkerJobPayload } from "./worker.types";

/**
 * Reusable Redis connection (singleton)
 */
const redisConnection: ConnectionOptions = {
  connection: new IORedis(config.redisUrl || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  }),
};

/**
 * Enum for all system queues (extendable)
 */
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
}

/**
 * Internal map of active queues
 */
const queues: Record<QueueName, Queue> = {} as any;

/**
 * Default job options (retry, backoff, etc.)
 */
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000, // 5 seconds
  },
  removeOnComplete: 50, // keep last 50 for monitoring
  removeOnFail: 100,
  timeout: 1000 * 60 * 5, // 5 minutes
};

/**
 * Create a queue (singleton per queue name)
 */
export const createQueue = (name: QueueName): Queue => {
  if (queues[name]) return queues[name];

  const queue = new Queue(name, {
    ...redisConnection,
    defaultJobOptions,
    prefix: `{pa360}:${name}`,
  });

  queues[name] = queue;
  logger.info(`[QUEUE] ✅ Queue created: ${name}`);
  return queue;
};

/**
 * Safely enqueue a job with robust error handling
 */
export const enqueueJob = async <T extends WorkerJobPayload>(
  queueName: QueueName,
  jobName: string,
  data: T,
  options?: JobsOptions
) => {
  try {
    const queue = queues[queueName] || createQueue(queueName);
    const job = await queue.add(jobName, data, { ...defaultJobOptions, ...options });
    logger.info(`[QUEUE:${queueName}] 📥 Enqueued job '${jobName}' (ID: ${job.id})`);
    return job;
  } catch (err: any) {
    logger.error(`[QUEUE:${queueName}] ❌ Failed to enqueue job '${jobName}': ${err.message}`);
    throw err;
  }
};

/**
 * Flush all jobs from a specific queue (use with caution)
 */
export const purgeQueue = async (queueName: QueueName) => {
  try {
    const queue = queues[queueName] || createQueue(queueName);
    await queue.drain(true);
    logger.warn(`[QUEUE:${queueName}] 🧹 Queue drained successfully`);
  } catch (err: any) {
    logger.error(`[QUEUE:${queueName}] ❌ Failed to purge queue: ${err.message}`);
  }
};

/**
 * Disconnect all queues (graceful shutdown)
 */
export const shutdownQueues = async () => {
  logger.info("[QUEUE] 📴 Shutting down all queues...");
  await Promise.all(
    Object.values(queues).map((queue) =>
      queue.close().catch((err) => logger.error(`[QUEUE] Close error: ${err.message}`))
    )
  );
  logger.info("[QUEUE] ✅ All queues closed cleanly.");
};