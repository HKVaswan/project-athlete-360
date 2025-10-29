/**
 * workers/index.ts
 * -------------------------------------------------------------
 * Central worker manager for background job queues.
 *
 * Enterprise features:
 *  - Modular queue registration (email, resources, etc.)
 *  - Graceful startup/shutdown
 *  - Unified error and retry strategy
 *  - Compatible with both in-memory (dev) and Redis (prod)
 */

import { Queue, Worker, QueueScheduler, Job } from "bullmq";
import IORedis from "ioredis";
import path from "path";
import { logger } from "../logger";
import { config } from "../config";

// Redis connection (uses REDIS_URL or defaults to local)
const connection = new IORedis(config.redisUrl || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

export const queues: Record<string, Queue> = {};
export const workers: Record<string, Worker> = {};
export const schedulers: Record<string, QueueScheduler> = {};

/**
 * Helper to register a new queue + worker pair.
 */
export const registerWorker = (
  name: string,
  processorPath: string,
  options: {
    concurrency?: number;
    attempts?: number;
    backoff?: number;
  } = {}
) => {
  const queue = new Queue(name, { connection });
  const scheduler = new QueueScheduler(name, { connection });

  const worker = new Worker(
    name,
    path.resolve(processorPath),
    {
      connection,
      concurrency: options.concurrency ?? 5,
      autorun: true,
    }
  );

  worker.on("completed", (job: Job) =>
    logger.info(`[WORKER:${name}] ✅ Job ${job.id} completed`)
  );
  worker.on("failed", (job, err) =>
    logger.error(`[WORKER:${name}] ❌ Job ${job?.id} failed: ${err.message}`)
  );

  queues[name] = queue;
  workers[name] = worker;
  schedulers[name] = scheduler;

  logger.info(`[WORKER] Registered ${name} worker.`);
};

/**
 * Initialize all workers for this app.
 * You can easily add new ones below.
 */
export const initWorkers = async () => {
  logger.info("[WORKER] Initializing background workers...");

  registerWorker("email", path.join(__dirname, "email.worker.js"));
  registerWorker("resourceProcessing", path.join(__dirname, "resourceProcessing.worker.js"));

  logger.info("[WORKER] ✅ All workers initialized.");
};

/**
 * Graceful shutdown for workers
 */
export const shutdownWorkers = async () => {
  logger.info("[WORKER] Shutting down all queues and workers...");
  await Promise.all([
    ...Object.values(workers).map((w) => w.close()),
    ...Object.values(schedulers).map((s) => s.close()),
    connection.quit(),
  ]);
  logger.info("[WORKER] ✅ Shutdown complete.");
};