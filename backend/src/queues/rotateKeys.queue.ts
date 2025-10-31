/**
 * src/queues/rotateKeys.queue.ts
 * --------------------------------------------------------------------------
 * 🔄 Key Rotation Queue
 *
 * Manages secure scheduling and triggering of cryptographic key rotation jobs.
 * This queue interfaces with `rotateKeys.worker.ts`.
 *
 * Supports:
 *  - Manual rotation requests from Super Admin
 *  - Automated scheduled rotation (e.g., via cron)
 *  - Job deduplication and retries
 * --------------------------------------------------------------------------
 */

import { Queue } from "bullmq";
import { config } from "../config";
import { logger } from "../logger";
import { redisConnection } from "../lib/redis";

const queueName = "rotate-keys-queue";

export const rotateKeysQueue = new Queue(queueName, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});

logger.info(`[QUEUE] 🔑 RotateKeys queue initialized.`);

/**
 * Enqueue a manual or system-triggered rotation job.
 */
export const enqueueKeyRotation = async (
  triggeredBy: "system" | "super_admin",
  adminId?: string,
  reason?: string
) => {
  try {
    await rotateKeysQueue.add(
      "rotate-keys",
      { triggeredBy, adminId, reason },
      { jobId: `rotate-keys-${Date.now()}` }
    );

    logger.info(`[QUEUE] 🚀 Key rotation job enqueued by ${triggeredBy}`);
  } catch (err: any) {
    logger.error(`[QUEUE] ❌ Failed to enqueue key rotation job: ${err.message}`);
    throw err;
  }
};

/**
 * Optional helper to schedule periodic key rotation
 * (e.g., every 30 days or weekly for testing)
 */
export const scheduleAutomaticKeyRotation = async (intervalDays = 30) => {
  const delay = intervalDays * 24 * 60 * 60 * 1000;
  try {
    await rotateKeysQueue.add(
      "scheduled-rotation",
      { triggeredBy: "system", reason: "Scheduled automatic rotation" },
      {
        repeat: { every: delay },
        jobId: "scheduled-key-rotation",
      }
    );

    logger.info(`[QUEUE] 🕒 Automatic key rotation scheduled every ${intervalDays} days.`);
  } catch (err: any) {
    logger.error(`[QUEUE] ❌ Failed to schedule automatic key rotation: ${err.message}`);
  }
};