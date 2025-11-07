/**
 * src/workers/queue.monitor.ts
 * --------------------------------------------------------------------
 * 🚀 Enterprise Queue Monitor Utility (v2.1)
 *
 * Responsibilities:
 *  - Periodically inspects all active queues and workers.
 *  - Detects failed, delayed, or stuck jobs.
 *  - Automatically retries eligible jobs (configurable).
 *  - Reports queue health metrics → Prometheus + telemetry.
 *  - Sends alerts and audit logs for anomalies.
 *  - Supports distributed multi-instance monitoring (idempotent).
 * --------------------------------------------------------------------
 */

import { context, trace } from "@opentelemetry/api";
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

let lastAlertTimestamp = 0;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between alerts

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
      this.checkAllQueues().catch((err) => {
        recordError("queue_monitor_unhandled_error", "medium");
        logger.error("[QUEUE MONITOR] ❌ Unhandled error:", err);
      });
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
   * Main monitoring logic
   */
  private async checkAllQueues() {
    if (this.isRunning) {
      logger.warn("[QUEUE MONITOR] Previous cycle still running — skipping this tick.");
      return;
    }

    this.isRunning = true;
    logger.debug(`[QUEUE MONITOR] 🔍 Inspecting ${Object.keys(queues).length} queues...`);

    const tracer = trace.getTracer("pa360.queue.monitor");
    const span = tracer.startSpan("queue.monitor.cycle");

    for (const [name, queue] of Object.entries(queues)) {
      const qSpan = tracer.startSpan(`queue.monitor.${name}`, {}, context.active());
      try {
        const [active, waiting, failed, delayed] = await Promise.all([
          queue.getActiveCount(),
          queue.getWaitingCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        const health = { active, waiting, failed, delayed };
        const total = active + waiting + failed + delayed;

        // 🔢 Metrics
        recordWorkerJobs(name, total);
        telemetry.record(`queue.${name}.active`, active);
        telemetry.record(`queue.${name}.failed`, failed);
        telemetry.record(`queue.${name}.delayed`, delayed);

        logger.info(`[QUEUE MONITOR] 📊 ${name} — ${JSON.stringify(health)}`);

        qSpan.setAttributes({
          "queue.name": name,
          "queue.active": active,
          "queue.failed": failed,
          "queue.delayed": delayed,
          "queue.waiting": waiting,
        });

        // 🚨 Failure alerts
        if (failed > ALERT_FAILED_THRESHOLD) {
          await this.triggerAlert(`High failure count in queue: ${name}`, {
            failed,
            threshold: ALERT_FAILED_THRESHOLD,
          });
          await this.retryFailedJobs(name);
        }

        // ⚠️ Delay alerts
        if (delayed > ALERT_DELAYED_THRESHOLD) {
          await this.triggerAlert(`High delayed job count in queue: ${name}`, {
            delayed,
            threshold: ALERT_DELAYED_THRESHOLD,
          });
        }

        // ⚙️ Add event markers to OpenTelemetry trace
        qSpan.addEvent("queue.health.reported", { ...health });
      } catch (err: any) {
        recordError("queue_monitor_error", "medium");
        qSpan.recordException(err);
        logger.error(`[QUEUE MONITOR] ❌ Error inspecting ${name}: ${err.message}`);
      } finally {
        qSpan.end();
      }
    }

    span.end();
    this.isRunning = false;
  }

  /**
   * Retry failed jobs automatically within retry limit
   */
  private async retryFailedJobs(queueName: string) {
    const queue = queues[queueName];
    const failedJobs = await queue.getFailed(0, 50);

    for (const job of failedJobs) {
      try {
        if ((job.attemptsMade ?? 0) < MAX_RETRY_ATTEMPTS) {
          await job.retry();
          logger.info(`[QUEUE MONITOR] 🔁 Retried job ${job.id} (${queueName})`);
        } else {
          logger.warn(
            `[QUEUE MONITOR] 🛑 Job ${job.id} exceeded retry limit (${MAX_RETRY_ATTEMPTS}).`
          );
        }
      } catch (err: any) {
        recordError("queue_job_retry_error", "low");
        logger.error(`[QUEUE MONITOR] ❌ Retry failed for job ${job.id}: ${err.message}`);
      }
    }
  }

  /**
   * Throttled alert dispatcher (audit + analytics + logs)
   */
  private async triggerAlert(message: string, data?: Record<string, any>) {
    const now = Date.now();
    if (now - lastAlertTimestamp < ALERT_COOLDOWN_MS) {
      logger.debug("[QUEUE MONITOR] ⏳ Alert suppressed (cooldown active)");
      return;
    }

    lastAlertTimestamp = now;
    const traceId = trace.getSpan(context.active())?.spanContext().traceId || "none";

    logger.warn(`[QUEUE MONITOR] ⚠️ ${message}`, { ...data, traceId });

    try {
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "QUEUE_ALERT",
        details: {
          message,
          ...data,
          environment: config.nodeEnv,
          traceId,
          timestamp: new Date().toISOString(),
        },
      });

      Analytics.telemetry("queue-alert", {
        message,
        traceId,
        env: config.nodeEnv,
        ...data,
      });
    } catch (err: any) {
      recordError("queue_monitor_alert_failed", "low");
      logger.error("[QUEUE MONITOR] ⚠️ Failed to log or send alert:", err.message);
    }
  }

  /**
   * Quick summary for API or Grafana dashboards
   */
  async getHealthSummary() {
    const summary: Record<string, any> = {};

    for (const [name, queue] of Object.entries(queues)) {
      try {
        const counts = await queue.getJobCounts();
        summary[name] = {
          ...counts,
          lastUpdated: new Date().toISOString(),
        };
      } catch (err: any) {
        summary[name] = { error: err.message };
      }
    }

    return {
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
      node: process.env.HOSTNAME || "unknown",
      summary,
    };
  }
}

// ───────────────────────────────────────────────
// ✅ Singleton Instance
// ───────────────────────────────────────────────
export const queueMonitor = new QueueMonitor();

// Optional auto-start in worker/infra mode
if (process.env.ENABLE_QUEUE_MONITOR === "true") {
  queueMonitor.start();
  process.on("SIGTERM", () => queueMonitor.stop());
  process.on("SIGINT", () => queueMonitor.stop());
}