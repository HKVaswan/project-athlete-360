/**
 * src/workers/alert.worker.ts
 * --------------------------------------------------------------------------
 * 🚨 Enterprise Alert Worker (Project Athlete 360) — v2.0
 *
 * Purpose:
 *  - Reliable & secure alert processor for async incidents.
 *  - Works across distributed environments using BullMQ + Redis.
 *  - Routes alerts to: PagerDuty, Slack, Sentry, Audit, Telemetry.
 *  - Enforces alert deduplication and severity-based throttling.
 *  - Sanitizes alert context to prevent accidental secret exposure.
 *  - Gracefully shuts down on container restarts (Kubernetes-safe).
 * --------------------------------------------------------------------------
 */

import { Worker, Job, Queue } from "bullmq";
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
const ALERT_COOLDOWN_MS = 60 * 1000; // 1 min between similar alerts

interface AlertJob {
  title: string;
  message: string;
  severity: "info" | "warning" | "error" | "critical";
  context?: Record<string, any>;
  source?: string;
}

/* --------------------------------------------------------------------------
 * 🔒 Secure Context Sanitization
 * -------------------------------------------------------------------------- */
const sanitizeContext = (context?: Record<string, any>): Record<string, any> | undefined => {
  if (!context) return undefined;

  const SENSITIVE_KEYS = ["password", "token", "authorization", "secret", "apikey", "api_key"];

  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(context)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      clean[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      clean[k] = sanitizeContext(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
};

/* --------------------------------------------------------------------------
 * 🧠 Core Alert Dispatcher
 * -------------------------------------------------------------------------- */
const lastAlertTimestamps = new Map<string, number>();

async function dispatchAlert(job: Job<AlertJob>): Promise<void> {
  const { title, message, severity, context, source } = job.data;
  const alertKey = `${severity}-${title}`;
  const now = Date.now();
  const lastSent = lastAlertTimestamps.get(alertKey);

  // Skip duplicate alerts within cooldown
  if (lastSent && now - lastSent < ALERT_COOLDOWN_MS) {
    logger.debug(`[ALERT WORKER] ⏸️ Skipping duplicate alert: ${alertKey}`);
    return;
  }

  const safeContext = sanitizeContext(context);
  logger.info(`[ALERT WORKER] 🚨 Processing alert: ${title} [${severity}]`, { source });
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
          details: safeContext,
        });
        await slackAlertClient.send({ title, message, severity, context: safeContext });
        Sentry.captureMessage(`[CRITICAL ALERT] ${title}: ${message}`, {
          level: "fatal",
          extra: safeContext,
        });
        break;

      case "error":
        Sentry.captureMessage(`[ERROR ALERT] ${title}: ${message}`, {
          level: "error",
          extra: safeContext,
        });
        await slackAlertClient.send({ title, message, severity, context: safeContext });
        break;

      case "warning":
        await slackAlertClient.send({ title, message, severity, context: safeContext });
        break;

      case "info":
      default:
        logger.info(`[ALERT WORKER] ℹ️ Info alert: ${title}`, safeContext);
        break;
    }

    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "ALERT_DISPATCH",
      details: { title, severity, source, message, safeContext },
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
      details: { title, severity, error: err.message, context: safeContext },
    });

    throw err; // Let BullMQ retry it
  }
}

/* --------------------------------------------------------------------------
 * 🧩 Worker Initialization
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
    settings: { retryProcessDelay: 2000 },
  }
);

alertWorker.on("completed", (job) =>
  logger.debug(`[ALERT WORKER] ✅ Completed alert job: ${job.id}`)
);

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
 * 🧪 Manual Test / Trigger
 * -------------------------------------------------------------------------- */
export async function enqueueTestAlert() {
  const queue = new Queue<AlertJob>(QUEUE_NAME, { connection: config.redis.connection });

  await queue.add(
    "test-alert",
    {
      title: "🧪 Test Alert",
      message: "This is a test alert from Project Athlete 360 (Alert Worker).",
      severity: "info",
      context: { env: config.nodeEnv, timestamp: new Date().toISOString() },
      source: "manual-test",
    },
    { removeOnComplete: true }
  );

  logger.info("[ALERT WORKER] 🧪 Test alert enqueued successfully.");
}

/* --------------------------------------------------------------------------
 * 🧹 Graceful Shutdown (K8s / Container Safe)
 * -------------------------------------------------------------------------- */
const gracefulShutdown = async () => {
  try {
    logger.info("[ALERT WORKER] 🧹 Gracefully shutting down...");
    await alertWorker.close();
    logger.info("[ALERT WORKER] ✅ Shutdown complete.");
    process.exit(0);
  } catch (err: any) {
    logger.error("[ALERT WORKER] ⚠️ Shutdown error:", err.message);
    process.exit(1);
  }
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

/* --------------------------------------------------------------------------
 * 🚀 Auto-start for worker environments
 * -------------------------------------------------------------------------- */
if (process.env.ENABLE_ALERT_WORKER === "true") {
  logger.info("[ALERT WORKER] 🚀 Starting Alert Worker...");
  alertWorker; // Automatically runs
}

export default alertWorker;