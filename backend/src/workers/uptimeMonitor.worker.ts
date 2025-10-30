/**
 * src/workers/uptimeMonitor.worker.ts
 * ------------------------------------------------------------------------
 * Uptime Monitor Worker (Enterprise Grade)
 *
 * Features:
 * - Periodic HTTP(s) health checks for configured endpoints
 * - Measures response time, status code, and optionally TLS expiry
 * - Config-driven checks (env / DB / monitoring queue)
 * - Pushes metrics to "monitoring" queue and alerts to "notifications" queue
 * - Retries with backoff on transient failures
 * - Robust error handling and safe defaults
 *
 * Usage:
 * - Register this worker in workers/index.ts and add a recurring job to the "uptimeMonitor" queue
 * - Configure endpoints in DB or via ENV var MONITOR_TARGETS (JSON array)
 */

import { Job } from "bullmq";
import axios, { AxiosRequestConfig } from "axios";
import tls from "tls";
import url from "url";
import { logger } from "../logger";
import { config } from "../config";
import prisma from "../prismaClient";
import { queues } from "./index";

type MonitorTarget = {
  id?: string; // optional DB id
  name: string;
  url: string;
  method?: "GET" | "HEAD" | "POST" | "PUT";
  timeoutMs?: number;
  expectedStatus?: number[]; // acceptable status codes
  checkTls?: boolean;
  frequencyMs?: number; // scheduling hint (not enforced here)
  alertOn?: {
    statusMismatch?: boolean;
    slowMs?: number;
    tlsExpiryDays?: number;
  };
};

// Default targets may be supplied via env for quick start
const DEFAULT_MONITOR_TARGETS: MonitorTarget[] = (() => {
  try {
    const envTargets = process.env.MONITOR_TARGETS;
    if (!envTargets) return [];
    return JSON.parse(envTargets);
  } catch {
    return [];
  }
})();

const DEFAULT_TIMEOUT = 10_000; // ms
const SLOW_THRESHOLD_MS = 2000; // ms default for alerting when not configured

/**
 * Perform a single HTTP check for a target.
 * Returns a structured result including metrics and optional tls info.
 */
async function checkHttpTarget(target: MonitorTarget) {
  const start = Date.now();
  const method = target.method ?? "GET";
  const timeout = target.timeoutMs ?? DEFAULT_TIMEOUT;
  const axiosConfig: AxiosRequestConfig = {
    method,
    url: target.url,
    timeout,
    validateStatus: () => true, // we'll evaluate status manually
    headers: { "User-Agent": `pa360-uptime-checker/1.0` },
  };

  let status = 0;
  let responseTime = 0;
  let ok = false;
  let errorMsg: string | null = null;

  try {
    const resp = await axios.request(axiosConfig);
    status = resp.status;
    responseTime = Date.now() - start;
    const expected = target.expectedStatus ?? [200];
    ok = expected.includes(status);
  } catch (err: any) {
    responseTime = Date.now() - start;
    errorMsg = err?.message ?? String(err);
    logger.warn(`[UPTIME] HTTP check failed for ${target.url}: ${errorMsg}`);
  }

  let tlsExpiryDate: string | null = null;
  let tlsExpiresInDays: number | null = null;

  if (target.checkTls) {
    try {
      const parsed = url.parse(target.url);
      const host = parsed.hostname ?? undefined;
      const port = Number(parsed.port) || 443;
      if (host) {
        const cert = await getPeerCertificate(host, port);
        if (cert && cert.valid_to) {
          tlsExpiryDate = new Date(cert.valid_to).toISOString();
          tlsExpiresInDays = Math.ceil((new Date(cert.valid_to).getTime() - Date.now()) / (24 * 3600 * 1000));
        }
      }
    } catch (err: any) {
      logger.warn(`[UPTIME] TLS check failed for ${target.url}: ${err?.message ?? err}`);
    }
  }

  return {
    targetName: target.name,
    targetUrl: target.url,
    ok,
    status,
    responseTime,
    errorMsg,
    tlsExpiryDate,
    tlsExpiresInDays,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Quick TLS peer certificate fetcher using Node's TLS socket.
 */
function getPeerCertificate(host: string, port = 443, timeout = 5_000): Promise<tls.PeerCertificate | null> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          resolve(cert && Object.keys(cert).length ? cert : null);
        } catch (err) {
          socket.end();
          reject(err);
        }
      }
    );

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS socket timeout"));
    });
  });
}

/**
 * Send alert to notifications queue (if available)
 * Payload should contain enough context to notify humans.
 */
async function sendAlert(alertPayload: { level: "critical" | "warning"; title: string; body: string; meta?: any }) {
  const queue = queues["notifications"];
  if (!queue) {
    logger.warn("[UPTIME] Notifications queue not configured — skipping alert");
    return;
  }

  try {
    await queue.add(
      "uptimeAlert",
      alertPayload,
      { removeOnComplete: true, attempts: 3, backoff: { type: "exponential", delay: 3000 } }
    );
    logger.info(`[UPTIME] Alert queued: ${alertPayload.title}`);
  } catch (err: any) {
    logger.error(`[UPTIME] Failed to enqueue alert: ${err.message}`);
  }
}

/**
 * Persist metric into DB if prisma model exists (optional)
 * This tries to write to a table `uptimeCheck` if present — safe failure if model missing.
 */
async function persistMetric(result: any) {
  try {
    // If schema contains uptimeCheck, Prisma client will have it.
    // We guard with any to avoid TS compile-time errors if model absent.
    const anyPrisma: any = prisma as any;
    if (typeof anyPrisma.uptimeCheck?.create === "function") {
      await anyPrisma.uptimeCheck.create({ data: result });
    } else {
      // store lightweight summary in audit log table if exists:
      if (typeof anyPrisma.auditLog?.create === "function") {
        await anyPrisma.auditLog.create({
          data: {
            type: "uptime_check",
            message: `${result.targetUrl} status=${result.status} ok=${result.ok}`,
            meta: result,
          },
        });
      }
    }
  } catch (err: any) {
    // Do not throw — metric persistence is best-effort.
    logger.debug(`[UPTIME] Persist metric failed (optional): ${err.message ?? err}`);
  }
}

/**
 * Main worker processor
 *
 * - Loads monitor targets from DB (preferred) or falls back to env-provided list
 * - Performs checks, pushes metrics to monitoring queue, and triggers alerts
 */
export default async function (job: Job) {
  logger.info(`[UPTIME WORKER] Starting uptime checks (job ${job.id})`);

  // Load targets from DB (table: monitorTarget) if exists, otherwise fallback to env/default
  let targets: MonitorTarget[] = DEFAULT_MONITOR_TARGETS;

  try {
    const anyPrisma: any = prisma as any;
    if (typeof anyPrisma.monitorTarget?.findMany === "function") {
      const dbTargets = await anyPrisma.monitorTarget.findMany({ where: { active: true } });
      if (Array.isArray(dbTargets) && dbTargets.length > 0) {
        targets = dbTargets.map((t: any) => ({
          id: t.id,
          name: t.name,
          url: t.url,
          method: t.method ?? "GET",
          timeoutMs: t.timeoutMs ?? DEFAULT_TIMEOUT,
          expectedStatus: t.expectedStatus ?? [200],
          checkTls: t.checkTls ?? false,
          frequencyMs: t.frequencyMs ?? undefined,
          alertOn: t.alertOn ?? undefined,
        }));
      }
    }
  } catch (err: any) {
    logger.debug(`[UPTIME] Could not load targets from DB: ${err.message}`);
    // continue with DEFAULT_MONITOR_TARGETS
  }

  if (!targets || targets.length === 0) {
    logger.info("[UPTIME] No monitor targets configured; nothing to do.");
    return;
  }

  const monitoringQueue = queues["monitoring"];
  const results: any[] = [];

  for (const target of targets) {
    try {
      const res = await checkHttpTarget(target);

      // Determine alert conditions
      const slowThreshold = target.alertOn?.slowMs ?? SLOW_THRESHOLD_MS;
      const shouldAlertStatus = target.alertOn?.statusMismatch ?? true;
      const tlsExpiryDaysThreshold = target.alertOn?.tlsExpiryDays ?? 14;

      // Persist metric (best-effort)
      await persistMetric({
        targetId: target.id ?? null,
        name: target.name,
        url: target.url,
        status: res.status,
        ok: res.ok,
        responseTime: res.responseTime,
        errorMsg: res.errorMsg,
        tlsExpiryDate: res.tlsExpiryDate,
        tlsExpiresInDays: res.tlsExpiresInDays,
        checkedAt: res.checkedAt,
      });

      // Push to monitoring queue
      if (monitoringQueue) {
        try {
          await monitoringQueue.add("uptimeMetric", { target: target.name, result: res }, { removeOnComplete: true, attempts: 1 });
        } catch (err: any) {
          logger.warn(`[UPTIME] Failed to push metric to monitoring queue: ${err.message}`);
        }
      }

      // Evaluate alerts
      if (!res.ok && shouldAlertStatus) {
        const title = `Uptime: ${target.name} returned status ${res.status}`;
        const body = `URL: ${target.url}\nStatus: ${res.status}\nResponse time: ${res.responseTime}ms\nError: ${res.errorMsg ?? "none"}`;
        await sendAlert({ level: "critical", title, body, meta: res });
      } else if (res.responseTime > slowThreshold) {
        const title = `Uptime: ${target.name} slow response (${res.responseTime}ms)`;
        const body = `URL: ${target.url}\nResponse time: ${res.responseTime}ms\nThreshold: ${slowThreshold}ms`;
        await sendAlert({ level: "warning", title, body, meta: res });
      }

      if (target.checkTls && res.tlsExpiresInDays !== null && res.tlsExpiresInDays !== undefined) {
        if (res.tlsExpiresInDays <= (target.alertOn?.tlsExpiryDays ?? tlsExpiryDaysThreshold)) {
          const title = `Uptime: ${target.name} TLS certificate expires in ${res.tlsExpiresInDays} day(s)`;
          const body = `URL: ${target.url}\nExpiry: ${res.tlsExpiryDate}\nDays left: ${res.tlsExpiresInDays}`;
          await sendAlert({ level: "warning", title, body, meta: res });
        }
      }

      results.push(res);
    } catch (err: any) {
      logger.error(`[UPTIME] Error checking ${target.url}: ${err.message}`);
      // Create a minimal failure metric
      const failMetric = {
        targetId: target.id ?? null,
        name: target.name,
        url: target.url,
        ok: false,
        status: 0,
        responseTime: 0,
        errorMsg: err?.message ?? String(err),
        checkedAt: new Date().toISOString(),
      };

      // Persist and push to queues best-effort
      try { await persistMetric(failMetric); } catch {}
      if (monitoringQueue) {
        try {
          await monitoringQueue.add("uptimeMetric", { target: target.name, result: failMetric }, { removeOnComplete: true, attempts: 1 });
        } catch {}
      }

      // Send critical alert
      await sendAlert({
        level: "critical",
        title: `Uptime: ${target.name} check failed`,
        body: `URL: ${target.url}\nError: ${err?.message ?? String(err)}`,
        meta: failMetric,
      });
    }
  } // end for targets

  logger.info(`[UPTIME] Completed checks for ${targets.length} targets`);
  return results;
}

/**
 * Optional helper: schedule recurring monitoring jobs (call from initWorkers)
 */
export const scheduleUptimeChecks = async () => {
  const queue = queues["uptimeMonitor"];
  if (!queue) {
    logger.warn("[UPTIME] uptimeMonitor queue not found — cannot schedule recurring job");
    return;
  }

  // default: run every 5 minutes
  const every = Number(process.env.UPTIME_CHECK_INTERVAL_MS || 5 * 60 * 1000);

  await queue.add(
    "uptimeMonitorRecurring",
    {},
    {
      repeat: { every },
      removeOnComplete: true,
      attempts: 1,
    }
  );

  logger.info(`[UPTIME] Scheduled uptime monitor recurring job (every ${every}ms)`);
};