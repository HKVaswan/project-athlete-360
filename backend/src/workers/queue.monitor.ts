/**
 * src/workers/queue.monitor.ts
 * --------------------------------------------------------------------
 * Enterprise Queue Monitor Utility
 *
 * Responsibilities:
 *  - Periodically inspects all active queues and workers.
 *  - Detects failed, delayed, or stuck jobs.
 *  - Automatically retries eligible jobs (configurable).
 *  - Reports queue health metrics to logger / analytics.
 *  - Sends alerts for anomalies (future: Slack, Email, etc.).
 */

import { queues, workers } from "./index";
import { logger } from "../logger";
import { config } from "../config";

const CHECK_INTERVAL = 60 * 1000; // 1 minute
const MAX_RETRY_ATTEMPTS = 3;

export class QueueMonitor {
  private timer: NodeJS.Timeout | null = null;

  /**
   * Start periodic monitoring of queues
   */
  start() {
    if (this.timer) return;
    logger.info("[QUEUE MONITOR] 🚀 Starting queue monitoring service...");

    this.timer = setInterval(async () => {
      await this.checkAllQueues();
    }, CHECK_INTERVAL);
  }

  /**
   * Stop the monitor safely
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("[QUEUE MONITOR] ⏹️ Monitoring stopped.");
    }
  }

  /**
   * Check all registered queues for anomalies
   */
  private async checkAllQueues() {
    for (const [name, queue] of Object.entries(queues)) {
      try {
        const [activeCount, waitingCount, failedCount, delayedCount] = await Promise.all([
          queue.getActiveCount(),
          queue.getWaitingCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        const healthStatus = {
          active: activeCount,
          waiting: waitingCount,
          failed: failedCount,
          delayed: delayedCount,
        };

        logger.info(`[QUEUE MONITOR] 📊 ${name} status: ${JSON.stringify(healthStatus)}`);

        if (failedCount > 0) await this.handleFailedJobs(name);
        if (delayedCount > 10) logger.warn(`[QUEUE MONITOR] ⚠️ ${name} has high delayed jobs count (${delayedCount}).`);
      } catch (err: any) {
        logger.error(`[QUEUE MONITOR] ❌ Failed to inspect queue '${name}': ${err.message}`);
      }
    }
  }

  /**
   * Retry failed jobs safely, respecting attempt limits
   */
  private async handleFailedJobs(queueName: string) {
    const queue = queues[queueName];
    const failedJobs = await queue.getFailed(0, 50); // fetch first 50 failed jobs

    for (const job of failedJobs) {
      try {
        if ((job.attemptsMade ?? 0) < MAX_RETRY_ATTEMPTS) {
          await job.retry();
          logger.info(`[QUEUE MONITOR] 🔁 Retried job ${job.id} (${queueName})`);
        } else {
          logger.warn(`[QUEUE MONITOR] 🛑 Job ${job.id} exceeded max retries.`);
        }
      } catch (err: any) {
        logger.error(`[QUEUE MONITOR] ❌ Failed to retry job ${job.id}: ${err.message}`);
      }
    }
  }

  /**
   * Generate a quick queue health summary
   */
  async getHealthSummary() {
    const summary: Record<string, any> = {};

    for (const [name, queue] of Object.entries(queues)) {
      try {
        const counts = await queue.getJobCounts();
        summary[name] = counts;
      } catch (err: any) {
        summary[name] = { error: err.message };
      }
    }

    return {
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
      summary,
    };
  }
}

export const queueMonitor = new QueueMonitor();