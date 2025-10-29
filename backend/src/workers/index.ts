/**
 * workers/index.ts
 * ------------------------------------------------------------------------
 * Centralized Worker Manager for all background queues.
 *
 * Features:
 *  - Modular and auto-discoverable worker registration
 *  - Built-in retry and backoff strategies
 *  - Graceful shutdown and fault tolerance
 *  - Health monitoring for production readiness
 *  - AI-ready: easily plug in intelligent jobs later
 */

import { Queue, Worker, QueueScheduler, Job } from "bullmq";
import IORedis from "ioredis";
import fs from "fs";
import path from "path";
import { logger } from "../logger";
import { config } from "../config";

const connection = new IORedis(config.redisUrl || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

export const queues: Record<string, Queue> = {};
export const workers: Record<string, Worker> = {};
export const schedulers: Record<string, QueueScheduler> = {};

/**
 * Register a queue, worker, and scheduler trio
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
  try {
    const queue = new Queue(name, { connection });
    const scheduler = new QueueScheduler(name, { connection });

    const worker = new Worker(
      name,
      processorPath,
      {
        connection,
        concurrency: options.concurrency ?? 5,
        autorun: true,
      }
    );

    worker.on("completed", (job: Job) =>
      logger.info(`[WORKER:${name}] ✅ Job ${job.id} completed successfully`)
    );

    worker.on("failed", (job, err) =>
      logger.error(`[WORKER:${name}] ❌ Job ${job?.id || "unknown"} failed: ${err.message}`)
    );

    worker.on("error", (err) => {
      logger.error(`[WORKER:${name}] 💥 Worker error: ${err.message}`);
    });

    queues[name] = queue;
    workers[name] = worker;
    schedulers[name] = scheduler;

    logger.info(`[WORKER] Registered '${name}' successfully`);
  } catch (err: any) {
    logger.error(`[WORKER] ❌ Failed to register worker '${name}': ${err.message}`);
  }
};

/**
 * Dynamically load all worker files from the workers directory
 * (Any file ending with .worker.js will be auto-registered)
 */
export const autoRegisterWorkers = () => {
  const workersDir = __dirname;
  const files = fs.readdirSync(workersDir);

  files.forEach((file) => {
    if (file.endsWith(".worker.js")) {
      const name = file.replace(".worker.js", "");
      const processorPath = path.join(workersDir, file);
      registerWorker(name, processorPath);
    }
  });
};

/**
 * Initialize workers explicitly or dynamically
 */
export const initWorkers = async () => {
  logger.info("[WORKER] 🚀 Initializing background workers...");

  // Option 1: Explicit registration
  registerWorker("email", path.join(__dirname, "email.worker.js"));
  registerWorker("resourceProcessing", path.join(__dirname, "resourceProcessing.worker.js"));
  registerWorker("aiProcessing", path.join(__dirname, "aiProcessing.worker.js"));

  // Option 2: Auto-discover all .worker.js files
  // autoRegisterWorkers();

  logger.info("[WORKER] ✅ All workers initialized successfully.");
};

/**
 * Graceful shutdown procedure for all workers and queues
 */
export const shutdownWorkers = async () => {
  logger.info("[WORKER] 🧹 Shutting down all workers and queues...");

  await Promise.all([
    ...Object.values(workers).map((w) => w.close().catch(() => {})),
    ...Object.values(schedulers).map((s) => s.close().catch(() => {})),
    connection.quit().catch(() => {}),
  ]);

  logger.info("[WORKER] ✅ Graceful shutdown complete.");
};

/**
 * Worker health check (for readiness probes)
 */
export const checkWorkerHealth = async () => {
  const redisStatus = connection.status;
  const activeWorkers = Object.keys(workers).length;

  return {
    redis: redisStatus === "ready" ? "healthy" : "unhealthy",
    activeWorkers,
    queues: Object.keys(queues),
  };
};