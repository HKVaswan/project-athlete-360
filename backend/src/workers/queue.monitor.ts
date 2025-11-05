/**
 * src/workers/queue.monitor.ts
 * --------------------------------------------------------------------
 * 🚀 Enterprise Queue Monitor Utility
 *
 * Responsibilities:
 *  - Periodically inspects all active queues and workers.
 *  - Detects failed, delayed, or stuck jobs.
 *  - Automatically retries eligible jobs (configurable).
 *  - Reports queue health metrics → Prometheus + telemetry.
 *  - Sends alerts and audit logs for anomalies.
 *  - Built for distributed & cloud environments.
 */

import { queues } from "./index";
import { logger } from "../logger";
import { config } from "../config";
import { recordWorkerJobs, recordError } from "../lib/core/metrics";
import { telemetry } from "../lib/telemetry";
import { auditService } from "../lib/audit";
import Analytics from "../lib/analytics";

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_RETRY_ATTEMPTS = 3;
const ALERT_DELAYED_THRESHOLD = 10;
const ALERT_FAILED_THRESHOLD = 5;

export class QueueMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the monitoring cycle
   */
  start() {
    if (this.timer) return;
    logger.info("[QUEUE MONITOR] 🚀 Queue monitoring service started.");

    this.timer = setInterval(() => {
      this.checkAllQueues().catch((err) =>
        logger.error("[QUEUE MONITOR] Unhandled error:", err)
      );
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stop the monitor gracefully
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("[QUEUE MONITOR] ⏹️ Monitoring stopped.");
    }
  }

  /**
   * Main check loop
   */
  private async checkAllQueues() {
    if (this.isRunning) {
      logger.warn("[QUEUE MONITOR] Previous cycle still running — skipping this tick.");
      return;
    }

    this.isRunning = true;
    logger.info(`[QUEUE MONITOR] 🔍 Inspecting all queues... (${Object.keys(queues).length})`);

    for (const [name, queue] of Object.entries(queues)) {
      try {
        const [active, waiting, failed, delayed] = await Promise.all([
          queue.getActiveCount(),
          queue.getWaitingCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        const health = { active, waiting, failed, delayed };
        recordWorkerJobs(name, active);
        telemetry.record(`queue.${name}.active`, active);
        telemetry.record(`queue.${name}.failed`, failed);
        telemetry.record(`queue.${name}.delayed`, delayed);

        logger.info(`[QUEUE MONITOR] 📊 ${name} → ${JSON.stringify(health)}`);

        // 🚨 Alerts and recovery logic
        if (failed > ALERT_FAILED_THRESHOLD) {
          await this.alert(`High failure count in queue: ${name}`, { failed });
          await this.handleFailedJobs(name);
        }

        if (delayed > ALERT_DELAYED_THRESHOLD) {
          await this.alert(`High delayed job count in queue: ${name}`, { delayed });
        }
      } catch (err: any) {
        recordError("queue_monitor_error", "medium");
        logger.error(`[QUEUE MONITOR] ❌ Error inspecting ${name}: ${err.message}`);
      }
    }

    this.isRunning = false;
  }

  /**
   * Automatically retry failed jobs within attempt limit
   */
  private async handleFailedJobs(queueName: string) {
    const queue = queues[queueName];
    const failedJobs = await queue.getFailed(0, 50);

    for (const job of failedJobs) {
      try {
        if ((job.attemptsMade ?? 0) < MAX_RETRY_ATTEMPTS) {
          await job.retry();
          logger.info(`[QUEUE MONITOR] 🔁 Retried job ${job.id} (${queueName})`);
        } else {
          logger.warn(`[QUEUE MONITOR] 🛑 Job ${job.id} exceeded retry limit (${MAX_RETRY_ATTEMPTS}).`);
        }
      } catch (err: any) {
        recordError("queue_job_retry_error", "low");
        logger.error(`[QUEUE MONITOR] ❌ Retry failed for job ${job.id}: ${err.message}`);
      }
    }
  }

  /**
   * Dispatch alert via analytics + audit trail
   */
  private async alert(message: string, data?: Record<string, any>) {
    logger.warn(`[QUEUE MONITOR] ⚠️ ${message}`, data || {});

    try {
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "QUEUE_ALERT",
        details: {
          message,
          ...data,
          timestamp: new Date().toISOString(),
        },
      });

      Analytics.telemetry("queue-alert", {
        message,
        environment: config.nodeEnv,
        ...data,
      });
    } catch (err: any) {
      logger.error("[QUEUE MONITOR] ⚠️ Failed to report alert:", err.message);
    }
  }

  /**
   * Summarized queue metrics for dashboards or API
   */
  async getHealthSummary() {
    const summary: Record<string, any> = {};

    for (const [name, queue] of Object.entries(queues)) {
      try {
        summary[name] = await queue.getJobCounts();
      } catch (err: any) {
        summary[name] = { error: err.message };
      }
    }

    return {
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
      summary,
    };
  }
}

// Singleton instance
export const queueMonitor = new QueueMonitor();

// Optional auto-start in worker mode
if (process.env.ENABLE_QUEUE_MONITOR === "true") {
  queueMonitor.start();
  process.on("SIGTERM", () => queueMonitor.stop());
  process.on("SIGINT", () => queueMonitor.stop());
}