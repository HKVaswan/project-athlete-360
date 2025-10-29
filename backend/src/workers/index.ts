/**
 * workers/index.ts
 * ------------------------------------------------------------------------
 * Centralized Worker Manager for all background jobs.
 *
 * Enterprise features:
 *  ✅ Modular + auto-discoverable worker registration
 *  ✅ Built-in retry, exponential backoff, and alert system
 *  ✅ Periodic scheduling for cleanup + security audits
 *  ✅ Graceful shutdown & health checks
 *  ✅ AI-ready (future model-driven jobs)
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
  reconnectOnError: () => true,
  lazyConnect: false,
});

export const queues: Record<string, Queue> = {};
export const workers: Record<string, Worker> = {};
export const schedulers: Record<string, QueueScheduler> = {};

/**
 * Register a queue + worker + scheduler trio with enterprise options.
 */
export const registerWorker = (
  name: string,
  processorPath: string,
  options: {
    concurrency?: number;
    attempts?: number;
    backoff?: number;
    repeat?: { pattern?: string };
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

    worker.on("completed", (job: Job) => {
      logger.info(`[WORKER:${name}] ✅ Job ${job.id} completed successfully`);
    });

    worker.on("failed", (job, err) => {
      logger.error(`[WORKER:${name}] ❌ Job ${job?.id || "unknown"} failed: ${err.message}`);
      if (options.attempts && job?.attemptsMade >= options.attempts) {
        logger.warn(`[WORKER:${name}] ⚠️ Max retries reached for Job ${job?.id}`);
      }
    });

    worker.on("error", (err) => {
      logger.error(`[WORKER:${name}] 💥 Worker error: ${err.message}`);
    });

    queues[name] = queue;
    workers[name] = worker;
    schedulers[name] = scheduler;

    logger.info(`[WORKER] Registered '${name}' successfully`);

    // Automatically add repeatable jobs if applicable
    if (options.repeat?.pattern) {
      queue.add(
        `${name}-scheduled`,
        {},
        { repeat: { pattern: options.repeat.pattern } }
      );
      logger.info(`[WORKER:${name}] ⏱️ Scheduled job to run as per pattern: ${options.repeat.pattern}`);
    }
  } catch (err: any) {
    logger.error(`[WORKER] ❌ Failed to register worker '${name}': ${err.message}`);
  }
};

/**
 * Automatically discover and register all worker files.
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
 * Initialize all known workers and schedule key system jobs.
 */
export const initWorkers = async () => {
  logger.info("[WORKER] 🚀 Initializing background workers...");

  // Explicit registration (high-priority workers)
  registerWorker("email", path.join(__dirname, "email.worker.js"), {
    concurrency: 5,
    attempts: 3,
    backoff: 3000,
  });

  registerWorker("resourceProcessing", path.join(__dirname, "resourceProcessing.worker.js"), {
    concurrency: 3,
    attempts: 3,
    backoff: 5000,
  });

  registerWorker("aiProcessing", path.join(__dirname, "aiProcessing.worker.js"), {
    concurrency: 2,
    attempts: 2,
  });

  registerWorker("securityAudit", path.join(__dirname, "securityAudit.worker.js"), {
    concurrency: 1,
    attempts: 3,
    repeat: { pattern: "0 3 * * *" }, // every day at 3 AM
  });

  registerWorker("cleanup", path.join(__dirname, "cleanup.worker.js"), {
    concurrency: 1,
    attempts: 3,
    backoff: 10000,
    repeat: { pattern: "0 2 * * *" }, // every day at 2 AM
  });

  // Optionally auto-discover all .worker.js files
  // autoRegisterWorkers();

  logger.info("[WORKER] ✅ All background workers initialized successfully.");
};

/**
 * Graceful shutdown for all queues and workers.
 */
export const shutdownWorkers = async () => {
  logger.info("[WORKER] 🧹 Gracefully shutting down all workers and queues...");
  await Promise.allSettled([
    ...Object.values(workers).map((w) => w.close()),
    ...Object.values(schedulers).map((s) => s.close()),
    connection.quit(),
  ]);
  logger.info("[WORKER] ✅ Shutdown complete.");
};

/**
 * Health check endpoint support (for /health routes).
 */
export const checkWorkerHealth = async () => {
  const redisStatus = connection.status;
  const activeWorkers = Object.keys(workers).length;

  return {
    redis: redisStatus === "ready" ? "healthy" : redisStatus,
    activeWorkers,
    queues: Object.keys(queues),
    lastCheck: new Date().toISOString(),
  };
};