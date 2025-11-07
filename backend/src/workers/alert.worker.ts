/**
 * src/workers/alert.worker.ts
 * --------------------------------------------------------------------------
 * 🚨 Enterprise Alert Worker (Project Athlete 360)
 *
 * Responsibilities:
 *  - Centralized background processor for alerts and incidents.
 *  - Consumes alert jobs from the queue system (BullMQ).
 *  - Dispatches alerts to:
 *      → PagerDuty (critical)
 *      → Slack (warning/info)
 *      → Sentry (error aggregation)
 *      → Audit + Telemetry systems
 *  - Deduplicates alerts and applies severity-based throttling.
 *  - Ensures reliability, retries, and graceful failure handling.
 * --------------------------------------------------------------------------
 */

import { Worker, Job } from "bullmq";
import { logger } from "../logger";
import { config } from "../config";
import { auditService } from "../services/audit.service";
import { recordError } from "../lib/core/metrics";
import { telemetry } from "../lib/telemetry";
import { pagerDutyClient } from "../integrations/pagerduty.bootstrap";
import { slackAlertClient } from "../integrations/slackAlert.bootstrap";
import * as Sentry from "@sentry/node";

const QUEUE_NAME = "alerts";
const ALERT_RETRY_LIMIT = 3;
const ALERT_COOLDOWN_MS = 60 * 1000; // 1 minute between similar alerts

interface AlertJob {
  title: string;
  message: string;
  severity: "info" | "warning" | "error" | "critical";
  context?: Record<string, any>;
  source?: string; // e.g. "systemHealth", "queueMonitor"
}

const lastAlertTimestamps = new Map<string, number>();

/* --------------------------------------------------------------------------
 * 🧠 Core Alert Dispatcher
 * -------------------------------------------------------------------------- */
async function dispatchAlert(job: Job<AlertJob>): Promise<void> {
  const { title, message, severity, context, source } = job.data;

  const alertKey = `${severity}-${title}`;
  const now = Date.now();
  const lastSent = lastAlertTimestamps.get(alertKey);

  // Prevent duplicate alerts within cooldown
  if (lastSent && now - lastSent < ALERT_COOLDOWN_MS) {
    logger.debug(`[ALERT WORKER] ⏸️ Skipping duplicate alert: ${alertKey}`);
    return;
  }

  logger.info(`[ALERT WORKER] 🚨 Processing alert: ${title} [${severity}]`);
  telemetry.record(`alerts.processed.${severity}`, 1);
  lastAlertTimestamps.set(alertKey, now);

  try {
    switch (severity) {
      case "critical":
        await pagerDutyClient.trigger({
          title,
          message,
          severity,
          source: source || "unknown",
          details: context,
        });
        await slackAlertClient.send({ title, message, severity, context });
        Sentry.captureMessage(`[CRITICAL ALERT] ${title}: ${message}`, {
          level: "fatal",
          extra: context,
        });
        break;

      case "error":
        Sentry.captureMessage(`[ERROR ALERT] ${title}: ${message}`, {
          level: "error",
          extra: context,
        });
        await slackAlertClient.send({ title, message, severity, context });
        break;

      case "warning":
        await slackAlertClient.send({ title, message, severity, context });
        break;

      case "info":
      default:
        logger.info(`[ALERT WORKER] ℹ️ Info alert: ${title}`, context);
        break;
    }

    // Audit log for traceability
    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "ALERT_DISPATCH",
      details: { title, severity, source, message, context },
    });

    logger.info(`[ALERT WORKER] ✅ Alert dispatched successfully: ${title}`);
  } catch (err: any) {
    recordError("alert_dispatch_failure", "medium");
    telemetry.record("alerts.failed", 1);
    logger.error(`[ALERT WORKER] ❌ Failed to dispatch alert: ${err.message}`);

    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "ALERT_DISPATCH_FAILURE",
      details: { title, severity, error: err.message, context },
    });

    throw err; // Let BullMQ retry it
  }
}

/* --------------------------------------------------------------------------
 * 🔁 Worker Initialization
 * -------------------------------------------------------------------------- */
export const alertWorker = new Worker<AlertJob>(
  QUEUE_NAME,
  async (job) => {
    await dispatchAlert(job);
  },
  {
    connection: config.redis.connection,
    concurrency: 3,
    limiter: { max: 5, duration: 1000 }, // 5 jobs/sec
  }
);

alertWorker.on("completed", (job) => {
  logger.debug(`[ALERT WORKER] ✅ Completed alert job: ${job.id}`);
});

alertWorker.on("failed", (job, err) => {
  recordError("alert_worker_job_failed", "medium");
  telemetry.record("alerts.worker.failed", 1);
  logger.error(`[ALERT WORKER] 💥 Job failed: ${job?.id} - ${err.message}`);
});

alertWorker.on("stalled", (jobId) => {
  recordError("alert_worker_stalled", "low");
  logger.warn(`[ALERT WORKER] ⚠️ Job stalled: ${jobId}`);
});

/* --------------------------------------------------------------------------
 * 🧩 Test / Manual Trigger Utility
 * -------------------------------------------------------------------------- */
export async function enqueueTestAlert() {
  const { Queue } = require("bullmq");
  const queue = new Queue<AlertJob>(QUEUE_NAME, {
    connection: config.redis.connection,
  });

  await queue.add(
    "test-alert",
    {
      title: "🧪 Test Alert",
      message: "This is a test alert from the Project Athlete 360 alert worker.",
      severity: "info",
      context: { env: config.nodeEnv, timestamp: new Date().toISOString() },
      source: "manual-test",
    },
    { removeOnComplete: true }
  );

  logger.info("[ALERT WORKER] 🧪 Test alert enqueued successfully.");
}

/* --------------------------------------------------------------------------
 * 🚀 Auto-start for worker environments
 * -------------------------------------------------------------------------- */
if (process.env.ENABLE_ALERT_WORKER === "true") {
  logger.info("[ALERT WORKER] 🚀 Starting Alert Worker...");
  alertWorker; // Worker automatically runs
}

export default alertWorker;