/**
 * src/workers/errorMonitor.worker.ts
 * ------------------------------------------------------------------------
 * Error Monitoring Worker (Enterprise Grade)
 *
 * Responsibilities:
 *  - Scans logs & DB error tables for anomalies
 *  - Aggregates and correlates errors by service, type, frequency
 *  - Triggers alerts when error thresholds exceed normal baseline
 *  - Supports Sentry / external monitoring integration
 *  - Stores summarized error metrics for dashboards
 *  - Fault-tolerant: continues even if one data source fails
 */

import { Job } from "bullmq";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { config } from "../config";
import { queues } from "./index";
import os from "os";
import axios from "axios";

/**
 * Internal interface for error metrics.
 */
interface ErrorMetric {
  service: string;
  type: string;
  count: number;
  lastSeen: string;
  severity: "info" | "warning" | "error" | "critical";
}

/**
 * Configuration
 */
const MAX_LOOKBACK_MINUTES = Number(process.env.ERROR_MONITOR_LOOKBACK_MINUTES || 30);
const ERROR_THRESHOLD = Number(process.env.ERROR_THRESHOLD || 10);
const ALERT_WEBHOOK_URL = process.env.ERROR_ALERT_WEBHOOK_URL || ""; // Optional Slack/Discord webhook
const ENABLE_SENTRY = process.env.SENTRY_DSN ? true : false;

/**
 * Optional: Send alert via notification queue or webhook.
 */
async function sendErrorAlert(payload: {
  title: string;
  body: string;
  level: "warning" | "critical";
  meta?: any;
}) {
  try {
    // If notifications queue exists — use it
    const queue = queues["notifications"];
    if (queue) {
      await queue.add("errorAlert", payload, {
        removeOnComplete: true,
        attempts: 2,
        backoff: { type: "exponential", delay: 3000 },
      });
      logger.info(`[ERROR MONITOR] Alert queued: ${payload.title}`);
      return;
    }

    // Fallback: Direct webhook
    if (ALERT_WEBHOOK_URL) {
      await axios.post(ALERT_WEBHOOK_URL, {
        username: "ErrorMonitor",
        content: `⚠️ **${payload.title}**\n${payload.body}`,
      });
      logger.info(`[ERROR MONITOR] Webhook alert sent`);
    }
  } catch (err: any) {
    logger.error(`[ERROR MONITOR] Failed to send alert: ${err.message}`);
  }
}

/**
 * Fetch error logs from database (if auditLog table exists)
 */
async function fetchDatabaseErrors(): Promise<ErrorMetric[]> {
  const results: ErrorMetric[] = [];
  const anyPrisma: any = prisma as any;
  if (typeof anyPrisma.auditLog?.findMany !== "function") return results;

  const since = new Date(Date.now() - MAX_LOOKBACK_MINUTES * 60 * 1000);

  try {
    const logs = await anyPrisma.auditLog.findMany({
      where: {
        type: { contains: "error" },
        createdAt: { gte: since },
      },
      select: { type: true, message: true, createdAt: true, service: true },
    });

    const grouped = new Map<string, ErrorMetric>();
    for (const log of logs) {
      const key = `${log.service ?? "core"}:${log.type}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          service: log.service ?? "core",
          type: log.type,
          count: 1,
          lastSeen: log.createdAt.toISOString(),
          severity: "error",
        });
      } else {
        current.count++;
        current.lastSeen = log.createdAt.toISOString();
      }
    }

    return Array.from(grouped.values());
  } catch (err: any) {
    logger.warn(`[ERROR MONITOR] Failed to fetch DB logs: ${err.message}`);
    return results;
  }
}

/**
 * Optionally integrate with Sentry API to check for new issues.
 * (Requires Sentry project and auth token)
 */
async function fetchSentryErrors(): Promise<ErrorMetric[]> {
  if (!ENABLE_SENTRY || !config.sentryDsn) return [];
  const SENTRY_API_URL = process.env.SENTRY_API_URL || "https://sentry.io/api/0";
  const SENTRY_AUTH = process.env.SENTRY_AUTH_TOKEN;
  const SENTRY_ORG = process.env.SENTRY_ORG;
  const SENTRY_PROJECT = process.env.SENTRY_PROJECT;

  if (!SENTRY_AUTH || !SENTRY_ORG || !SENTRY_PROJECT) return [];

  try {
    const resp = await axios.get(
      `${SENTRY_API_URL}/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/`,
      { headers: { Authorization: `Bearer ${SENTRY_AUTH}` } }
    );
    const data = resp.data || [];

    return data.slice(0, 10).map((issue: any) => ({
      service: "backend",
      type: issue.title,
      count: issue.count,
      lastSeen: issue.lastSeen,
      severity: "critical",
    }));
  } catch (err: any) {
    logger.debug(`[ERROR MONITOR] Sentry API fetch failed: ${err.message}`);
    return [];
  }
}

/**
 * Core anomaly detection — detects error spikes.
 */
async function detectAnomalies(metrics: ErrorMetric[]) {
  for (const metric of metrics) {
    if (metric.count >= ERROR_THRESHOLD) {
      const title = `High error rate detected in ${metric.service}`;
      const body = `Type: ${metric.type}\nCount: ${metric.count}\nLast seen: ${metric.lastSeen}\nHost: ${os.hostname()}`;
      await sendErrorAlert({ title, body, level: "critical", meta: metric });
    }
  }
}

/**
 * Persist error summary to DB if table exists
 */
async function persistErrorSummary(metrics: ErrorMetric[]) {
  const anyPrisma: any = prisma as any;
  if (typeof anyPrisma.errorSummary?.create !== "function") return;

  try {
    for (const m of metrics) {
      await anyPrisma.errorSummary.create({
        data: {
          service: m.service,
          type: m.type,
          count: m.count,
          severity: m.severity,
          lastSeen: new Date(m.lastSeen),
        },
      });
    }
  } catch (err: any) {
    logger.debug(`[ERROR MONITOR] Persist summary failed: ${err.message}`);
  }
}

/**
 * Main worker function
 */
export default async function (job: Job) {
  logger.info(`[ERROR MONITOR] Starting job ${job.id}`);

  const allMetrics: ErrorMetric[] = [];

  try {
    const dbMetrics = await fetchDatabaseErrors();
    const sentryMetrics = await fetchSentryErrors();
    const combined = [...dbMetrics, ...sentryMetrics];

    allMetrics.push(...combined);

    // Persist summary
    await persistErrorSummary(combined);

    // Detect anomalies and send alerts
    await detectAnomalies(combined);

    logger.info(`[ERROR MONITOR] ✅ Completed analysis for ${combined.length} metrics`);
  } catch (err: any) {
    logger.error(`[ERROR MONITOR] ❌ Failed to complete monitoring job: ${err.message}`);
    await sendErrorAlert({
      title: "Error Monitor Failure",
      body: `Error monitor itself failed: ${err.message}`,
      level: "critical",
    });
  }

  return allMetrics;
}

/**
 * Optional scheduler registration
 */
export const scheduleErrorMonitor = async () => {
  const queue = queues["errorMonitor"];
  if (!queue) {
    logger.warn("[ERROR MONITOR] No queue found for errorMonitor");
    return;
  }

  const every = Number(process.env.ERROR_MONITOR_INTERVAL_MS || 15 * 60 * 1000); // default 15 min
  await queue.add(
    "errorMonitorRecurring",
    {},
    {
      repeat: { every },
      removeOnComplete: true,
    }
  );

  logger.info(`[ERROR MONITOR] Scheduled recurring job every ${every / 60000} min`);
};