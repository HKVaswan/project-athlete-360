/**
 * src/workers/queueMonitor.worker.ts
 * ------------------------------------------------------------------------
 * Enterprise Queue Monitor Worker
 *
 * Responsibilities:
 *  - Runs periodic queue health scans
 *  - Detects stuck, delayed, and failed jobs
 *  - Cleans completed/failed jobs based on retention policy
 *  - Emits metrics to monitoring service (future: Prometheus / Slack)
 *  - Designed to run as background BullMQ worker
 */

import { Job } from "bullmq";
import { queues } from "./index";
import { logger } from "../logger";
import { config } from "../config";

const MAX_COMPLETED_LIFETIME = 1000 * 60 * 60 * 24; // 24h
const MAX_FAILED_LIFETIME = 1000 * 60 * 60 * 24 * 3; // 3 days

/**
 * Helper: Clean up jobs older than retention policy
 */
async function cleanOldJobs() {
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const cleanedCompleted = await queue.clean(MAX_COMPLETED_LIFETIME, 1000, "completed");
      const cleanedFailed = await queue.clean(MAX_FAILED_LIFETIME, 1000, "failed");

      if (cleanedCompleted.length || cleanedFailed.length) {
        logger.info(
          `[QUEUE MONITOR WORKER] 🧹 Cleaned ${cleanedCompleted.length} completed & ${cleanedFailed.length} failed jobs from ${name}`
        );
      }
    } catch (err: any) {
      logger.error(`[QUEUE MONITOR WORKER] ❌ Failed cleaning ${name}: ${err.message}`);
    }
  }
}

/**
 * Helper: Detect and log anomalies across all queues
 */
async function analyzeQueues() {
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const counts = await queue.getJobCounts();
      if (counts.failed > 5) {
        logger.warn(`[QUEUE MONITOR WORKER] ⚠️ High failed job count in ${name}: ${counts.failed}`);
      }
      if (counts.delayed > 10) {
        logger.warn(`[QUEUE MONITOR WORKER] ⏰ High delayed job count in ${name}: ${counts.delayed}`);
      }
    } catch (err: any) {
      logger.error(`[QUEUE MONITOR WORKER] ❌ Error analyzing ${name}: ${err.message}`);
    }
  }
}

/**
 * Processor: Periodic health monitoring
 */
export default async function (job: Job) {
  logger.info(`[QUEUE MONITOR WORKER] 🔍 Running health check job ${job.id}`);

  try {
    await analyzeQueues();
    await cleanOldJobs();

    logger.info(`[QUEUE MONITOR WORKER] ✅ Health check completed for all queues`);
  } catch (err: any) {
    logger.error(`[QUEUE MONITOR WORKER] ❌ Error during monitoring job ${job.id}: ${err.message}`);
    throw err;
  }
}

/**
 * Optional: Schedule job periodically (handled externally by worker queue)
 */
export const scheduleQueueMonitorJob = async () => {
  const queue = queues["queueMonitor"];
  if (!queue) return;

  await queue.add(
    "queueMonitorJob",
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // every hour
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  logger.info(`[QUEUE MONITOR WORKER] ⏱️ Scheduled hourly queue monitor job.`);
};