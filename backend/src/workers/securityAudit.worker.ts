/**
 * workers/securityAudit.worker.ts
 * -------------------------------------------------------------
 * Security Audit Worker (Enterprise Grade)
 *
 * Responsibilities:
 *  - Periodically scans DB for suspicious patterns (burst creations, many updates, token floods).
 *  - Emits actionable alerts (email + optional webhook).
 *  - Designed to be safe (doesn't leak PII), idempotent and robust.
 *
 * Extendable: add detectors that analyze audit_logs, auth_attempts, IPs, or external SIEM.
 */

import { Job } from "bullmq";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { config } from "../config";
import fetch from "node-fetch";

const redisConnection = new IORedis(config.redisUrl || process.env.REDIS_URL || "redis://127.0.0.1:6379");

// Email queue (ensure this queue name is registered in workers/index.ts)
const emailQueue = new Queue("email", { connection: redisConnection });

type ScanType = "periodic-scan" | "on-demand";

interface SecurityAuditJob {
  type: ScanType;
  windowMinutes?: number; // scan window in minutes
  thresholds?: {
    newUsersPerWindow?: number;
    athleteCreatesPerUser?: number;
    resourceUploadsPerUser?: number;
    attendanceEditsPerUser?: number;
    refreshTokenIssuesPerUser?: number;
  };
  notifyWebhook?: string | null;
}

/**
 * Default thresholds — tune these to your expected traffic
 */
const DEFAULT_THRESHOLDS = {
  newUsersPerWindow: 50, // if >50 new users in window -> alert
  athleteCreatesPerUser: 20, // if one coach creates >20 athletes in window -> alert
  resourceUploadsPerUser: 50, // if one user uploads >50 resources in window -> alert
  attendanceEditsPerUser: 200, // if one user edits attendance >200 times in window -> alert
  refreshTokenIssuesPerUser: 30, // possible token abuse
};

const DEFAULT_WINDOW_MINUTES = 10;

/**
 * Build time window
 */
const buildWindow = (minutes: number) => {
  const now = new Date();
  const from = new Date(now.getTime() - minutes * 60 * 1000);
  return { from, to: now };
};

/**
 * Safe alert sender — posts an email job and optionally calls webhook
 */
async function sendAlert(subject: string, body: string, webhook?: string | null) {
  try {
    // enqueue email to admin(s) — you can tailor recipients via config
    const adminEmails = config.securityAlertEmails?.split(",").map((s: string) => s.trim()) || [config.smtpFromAdmin || "admin@example.com"];

    for (const to of adminEmails) {
      await emailQueue.add("securityAlert", {
        type: "security-alert",
        payload: {
          to,
          inviter: "System",
          title: subject,
          content: body,
        },
      }, { attempts: 3, backoff: { type: "exponential", delay: 1000 }});
    }

    // optional webhook alert (for Slack / PagerDuty / custom SIEM)
    if (webhook) {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, timestamp: new Date().toISOString() }),
        timeout: 5000,
      }).catch((err) => {
        logger.warn(`[SECURITY-AUDIT] webhook notify failed: ${err?.message || err}`);
      });
    }

    logger.info(`[SECURITY-AUDIT] Alert enqueued: ${subject}`);
  } catch (err: any) {
    logger.error(`[SECURITY-AUDIT] Failed to send alert: ${err.message}`);
  }
}

/**
 * Detector: Spike in new users
 */
async function detectNewUserSpike(windowMinutes: number, threshold: number) {
  const { from, to } = buildWindow(windowMinutes);
  const count = await prisma.user.count({ where: { createdAt: { gte: from, lte: to } } });
  logger.debug(`[SECURITY-AUDIT] new users in last ${windowMinutes}m: ${count}`);
  if (count >= threshold) {
    return { triggered: true, details: { count, windowMinutes } };
  }
  return { triggered: false };
}

/**
 * Detector: Many athlete creations by a single user (possible bot/abuse)
 */
async function detectBulkAthleteCreates(windowMinutes: number, perUserThreshold: number) {
  const { from, to } = buildWindow(windowMinutes);

  const rows = await prisma.athlete.groupBy({
    by: ["createdBy", "userId"],
    where: { createdAt: { gte: from, lte: to } },
    _count: { _all: true },
    orderBy: { _count: { _all: "desc" } },
    take: 10,
  }).catch((err) => {
    // If schema doesn't have createdBy or grouping fails, return no triggers
    logger.debug("[SECURITY-AUDIT] athlete groupBy unavailable or failed", err);
    return [];
  });

  // rows may be empty if createdBy doesnt exist or groupBy unsupported
  const offenders = (rows || []).filter((r: any) => r._count._all >= perUserThreshold);

  if (offenders.length > 0) return { triggered: true, offenders, windowMinutes };
  return { triggered: false };
}

/**
 * Detector: Resource uploads burst
 */
async function detectResourceUploadBurst(windowMinutes: number, perUserThreshold: number) {
  const { from, to } = buildWindow(windowMinutes);

  const rows = await prisma.resource.groupBy({
    by: ["uploaderId"],
    where: { createdAt: { gte: from, lte: to } },
    _count: { _all: true },
    orderBy: { _count: { _all: "desc" } },
    take: 10,
  }).catch((err) => {
    logger.debug("[SECURITY-AUDIT] resource groupBy failed", err);
    return [];
  });

  const offenders = (rows || []).filter((r: any) => r._count._all >= perUserThreshold);

  if (offenders.length > 0) return { triggered: true, offenders, windowMinutes };
  return { triggered: false };
}

/**
 * Detector: Attendance edit flood
 */
async function detectAttendanceEdits(windowMinutes: number, perUserThreshold: number) {
  const { from, to } = buildWindow(windowMinutes);

  const rows = await prisma.attendance.groupBy({
    by: ["updatedBy"], // assumes attendance has updatedBy; if not present, this may fail
    where: { updatedAt: { gte: from, lte: to } },
    _count: { _all: true },
    orderBy: { _count: { _all: "desc" } },
    take: 10,
  }).catch((err) => {
    logger.debug("[SECURITY-AUDIT] attendance groupBy failed", err);
    return [];
  });

  const offenders = (rows || []).filter((r: any) => r._count._all >= perUserThreshold);

  if (offenders.length > 0) return { triggered: true, offenders, windowMinutes };
  return { triggered: false };
}

/**
 * Detector: Refresh token issuance flood (possible automated token creation)
 */
async function detectRefreshTokenFlood(windowMinutes: number, perUserThreshold: number) {
  const { from, to } = buildWindow(windowMinutes);

  const rows = await prisma.refreshToken.groupBy({
    by: ["userId"],
    where: { issuedAt: { gte: from, lte: to } },
    _count: { _all: true },
    orderBy: { _count: { _all: "desc" } },
    take: 10,
  }).catch((err) => {
    logger.debug("[SECURITY-AUDIT] refreshToken groupBy failed", err);
    return [];
  });

  const offenders = (rows || []).filter((r: any) => r._count._all >= perUserThreshold);

  if (offenders.length > 0) return { triggered: true, offenders, windowMinutes };
  return { triggered: false };
}

/**
 * Main worker entry
 */
export default async function (job: Job<SecurityAuditJob>) {
  const trace = `SEC-AUDIT-${job.id}-${Date.now()}`;
  logger.info(`[SECURITY-AUDIT] Starting job ${trace} - type=${job.data.type}`);

  const windowMinutes = job.data.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(job.data.thresholds || {}) };
  const webhook = job.data.notifyWebhook ?? null;

  try {
    // 1) New users spike detector
    const newUserSpike = await detectNewUserSpike(windowMinutes, thresholds.newUsersPerWindow);
    if (newUserSpike.triggered) {
      const subject = `Security Alert: New user spike (${newUserSpike.details.count} new users)`;
      const body = `Security Audit (${trace}): Detected ${newUserSpike.details.count} new user accounts created in the last ${windowMinutes} minutes.\n\nInvestigate immediate origin and registration flow.`;
      await sendAlert(subject, body, webhook);
    }

    // 2) Bulk athlete creates
    const bulkAthlete = await detectBulkAthleteCreates(windowMinutes, thresholds.athleteCreatesPerUser);
    if (bulkAthlete.triggered) {
      const subject = `Security Alert: Bulk athlete creation detected`;
      const body = `Security Audit (${trace}): The following creators created many athlete profiles in the last ${windowMinutes} minutes:\n${JSON.stringify(bulkAthlete.offenders, null, 2)}\n\nPlease review for abuse.`;
      await sendAlert(subject, body, webhook);
    }

    // 3) Resource upload burst
    const resourceBurst = await detectResourceUploadBurst(windowMinutes, thresholds.resourceUploadsPerUser);
    if (resourceBurst.triggered) {
      const subject = `Security Alert: Resource upload burst detected`;
      const body = `Security Audit (${trace}): High resource upload activity detected:\n${JSON.stringify(resourceBurst.offenders, null, 2)}\n\nPossible automated uploads or exfil attempt.`;
      await sendAlert(subject, body, webhook);
    }

    // 4) Attendance edits flood
    const attendanceFlood = await detectAttendanceEdits(windowMinutes, thresholds.attendanceEditsPerUser);
    if (attendanceFlood.triggered) {
      const subject = `Security Alert: Attendance edits flood`;
      const body = `Security Audit (${trace}): Attendance was edited many times by:\n${JSON.stringify(attendanceFlood.offenders, null, 2)}\n\nVerify identity and recent sessions.`;
      await sendAlert(subject, body, webhook);
    }

    // 5) Refresh token issuance flood
    const tokenFlood = await detectRefreshTokenFlood(windowMinutes, thresholds.refreshTokenIssuesPerUser);
    if (tokenFlood.triggered) {
      const subject = `Security Alert: Possible token issuance abuse`;
      const body = `Security Audit (${trace}): High number of refresh tokens issued:\n${JSON.stringify(tokenFlood.offenders, null, 2)}\n\nConsider immediate token revocation for suspicious accounts.`;
      await sendAlert(subject, body, webhook);
    }

    logger.info(`[SECURITY-AUDIT] Job ${trace} completed`);
  } catch (err: any) {
    logger.error(`[SECURITY-AUDIT] Job ${trace} failed: ${err.message}`, err);
    throw err;
  }
}