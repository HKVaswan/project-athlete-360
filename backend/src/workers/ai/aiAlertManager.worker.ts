// src/workers/ai/aiAlertManager.worker.ts
/**
 * aiAlertManager.worker.ts
 *
 * Central AI Alert Manager worker
 * - Deduplicates & rate-limits AI alerts
 * - Persists alerts (if DB model exists) or falls back to queue/log
 * - Sends notifications to coaches, institution admins, and escalates to super-admins
 * - Queues email/push jobs for downstream workers
 *
 * Expected incoming job data:
 *  { athleteId: string, type: string, severity: 'info'|'warning'|'critical', message: string, meta?: any }
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { queues } from "../index";
import IORedis from "ioredis";
import crypto from "crypto";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });

// configurable dedupe window (ms)
const DEDUPE_WINDOW = Number(process.env.AI_ALERT_DEDUPE_MS || 1000 * 60 * 10); // default 10m
const ESCALATION_SEVERITY = process.env.AI_ALERT_ESCALATION_SEVERITY || "critical"; // escalate when >= critical

type IncomingAlert = {
  athleteId?: string;
  type: string;
  severity?: "info" | "warning" | "critical";
  message: string;
  source?: string; // worker name
  createdAt?: string;
  meta?: Record<string, any>;
  notifyCoach?: boolean; // whether coach should be notified
  notifyInstitutionAdmin?: boolean;
};

const systemSenderId = process.env.SYSTEM_SENDER_USER_ID || null; // optional: system user to use as message sender
const superAdminEmails = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);

// safe hash for dedupe key
const makeAlertKey = (payload: IncomingAlert) => {
  const base = `${payload.athleteId ?? "global"}|${payload.type}|${JSON.stringify(payload.meta ?? {})}`;
  const hash = crypto.createHash("sha256").update(base).digest("hex").slice(0, 16);
  return `ai:alert:${hash}`;
};

// helper to try persist alert in DB if Alert model exists, otherwise throw and fallback
const persistAlert = async (payload: IncomingAlert) => {
  try {
    // attempt to write to `alert` model (if you added it to schema)
    // fields we try: athleteId, type, severity, message, meta, createdAt
    const created = await (prisma as any).alert.create({
      data: {
        athleteId: payload.athleteId ?? null,
        type: payload.type,
        severity: payload.severity ?? "info",
        message: payload.message,
        meta: payload.meta ?? {},
        createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
      },
    });
    return { persisted: true, record: created };
  } catch (err) {
    // If "model not found" or any db error, bubble to caller to handle fallback
    throw err;
  }
};

const createInAppMessageForRecipient = async (recipientId: string, title: string, content: string, attachments?: any) => {
  if (!recipientId) return null;
  try {
    // use Message model for in-app messages
    const msg = await prisma.message.create({
      data: {
        senderId: systemSenderId ?? recipientId, // if no system sender, set self to avoid null constraint
        receiverId: recipientId,
        title,
        content,
        attachments: attachments ? attachments : null,
      },
    });
    return msg;
  } catch (err) {
    logger.warn("[AI:AlertMgr] Failed to create in-app message, falling back to queue", err?.message || err);
    return null;
  }
};

const queueNotification = async (payload: {
  kind: "email" | "push" | "in-app" | "slack";
  to: string | string[];
  title: string;
  body: string;
  meta?: any;
}) => {
  try {
    if (!queues["notifications"]) {
      logger.warn("[AI:AlertMgr] 'notifications' queue not found, skipping queueNotification");
      return null;
    }
    // use a generated jobId so duplicate notifications in short interval can be deduped by the queue
    const jobId = `notify:${payload.kind}:${crypto.createHash("md5").update(JSON.stringify(payload)).digest("hex")}`;
    await queues["notifications"].add("send", payload, { jobId, removeOnComplete: true, attempts: 3, backoff: { type: "exponential", delay: 2000 } });
    return true;
  } catch (err) {
    logger.error("[AI:AlertMgr] queueNotification failed:", err?.message || err);
    return null;
  }
};

const escalateToSuperAdmins = async (payload: IncomingAlert) => {
  try {
    if (!superAdminEmails.length) {
      logger.warn("[AI:AlertMgr] No super-admin emails configured; skip escalation.");
      return;
    }

    const subject = `[ALERT][${payload.severity?.toUpperCase() ?? "INFO"}] ${payload.type} — ${payload.athleteId ?? "global"}`;
    const body = `
      AI Alert triggered:
      Type: ${payload.type}
      Severity: ${payload.severity}
      Athlete: ${payload.athleteId ?? "N/A"}
      Message: ${payload.message}
      Meta: ${JSON.stringify(payload.meta ?? {})}
      Source: ${payload.source ?? "ai"}
      Time: ${new Date().toISOString()}
    `;

    // push to email queue
    await queueNotification({ kind: "email", to: superAdminEmails, title: subject, body, meta: { alert: payload } });

    // push to high-priority notifications queue as well (if exists)
    if (queues["highPriority"]) {
      await queues["highPriority"].add("escalation", { payload }, { removeOnComplete: true, attempts: 5 });
    }

    logger.info(`[AI:AlertMgr] Escalated alert to super-admins (${superAdminEmails.length})`);
  } catch (err) {
    logger.error("[AI:AlertMgr] escalateToSuperAdmins failed:", err?.message || err);
  }
};

export default async function (job: Job<IncomingAlert>) {
  const payload = job.data;
  const receivedAt = new Date().toISOString();
  logger.info(`[AI:AlertMgr] Received alert: type=${payload.type} severity=${payload.severity} athlete=${payload.athleteId ?? "global"}`);

  const alertKey = makeAlertKey(payload);

  try {
    // 1) Deduplicate: use redis SETNX with TTL
    const now = Date.now();
    const wasSet = await redis.set(alertKey, String(now), "PX", DEDUPE_WINDOW, "NX"); // set only if not exists
    if (!wasSet) {
      // duplicate alert within dedupe window -> ignore or update counter
      await redis.incr(`${alertKey}:count`);
      logger.info(`[AI:AlertMgr] Duplicate alert suppressed (key=${alertKey})`);
      return { success: true, reason: "duplicate_suppressed" };
    }

    // 2) Persist (best-effort)
    let persisted = false;
    let persistedRecord: any = null;
    try {
      const result = await persistAlert({ ...payload, createdAt: receivedAt });
      persisted = true;
      persistedRecord = result.record ?? result;
      logger.info(`[AI:AlertMgr] Alert persisted to DB (id=${persistedRecord?.id ?? "unknown"})`);
    } catch (dbErr) {
      // If we fail because alert model doesn't exist, fallback gracefully
      logger.warn("[AI:AlertMgr] DB persist failed; falling back to queue+log. Error:", dbErr?.message ?? dbErr);
      persisted = false;
    }

    // 3) Notify recipients depending on payload flags
    const notifications: Array<Promise<any>> = [];

    // If payload requests coach/institution notification, try to find coach or institution admins
    if (payload.notifyCoach && payload.athleteId) {
      try {
        // Fetch coach(s) of the athlete (via coachInstitution link)
        const coachLink = await prisma.coachInstitution.findFirst({
          where: { institutionId: (await prisma.athlete.findUnique({ where: { id: payload.athleteId }, select: { institutionId: true } })).institutionId },
          include: { coach: true },
        });
        if (coachLink?.coach) {
          const coachId = coachLink.coach.id;
          const title = `AI Alert — ${payload.type}`;
          const body = payload.message;
          // create in-app message (best effort)
          notifications.push(createInAppMessageForRecipient(coachId, title, body, payload.meta));
          // queue email/push
          notifications.push(queueNotification({ kind: "email", to: coachLink.coach.email ? [coachLink.coach.email] : [], title, body, meta: payload }));
          notifications.push(queueNotification({ kind: "push", to: coachId, title, body, meta: payload }));
        }
      } catch (err) {
        logger.warn("[AI:AlertMgr] Coach notification failed:", err?.message || err);
      }
    }

    if (payload.notifyInstitutionAdmin && payload.athleteId) {
      try {
        // determine institution admins for this athlete
        const athlete = await prisma.athlete.findUnique({ where: { id: payload.athleteId }, select: { institutionId: true } });
        if (athlete?.institutionId) {
          const admins = await prisma.institution.findUnique({
            where: { id: athlete.institutionId },
            include: { admin: true },
          });
          if (admins?.admin?.length) {
            for (const adm of admins.admin) {
              const title = `AI Alert for athlete ${payload.athleteId} — ${payload.type}`;
              notifications.push(createInAppMessageForRecipient(adm.id, title, payload.message, payload.meta));
              notifications.push(queueNotification({ kind: "email", to: adm.email ? [adm.email] : [], title, body: payload.message, meta: payload }));
            }
          }
        }
      } catch (err) {
        logger.warn("[AI:AlertMgr] Institution admin notification failed:", err?.message || err);
      }
    }

    // 4) Add to notifications queue for global monitoring dashboards
    try {
      await queueNotification({
        kind: "in-app",
        to: "monitoring", // convention: 'monitoring' topic
        title: `AI: ${payload.type} [${payload.severity}]`,
        body: payload.message,
        meta: { athleteId: payload.athleteId, severity: payload.severity, source: payload.source, persisted },
      });
    } catch (err) {
      logger.warn("[AI:AlertMgr] failed to queue dashboard notification", err?.message || err);
    }

    // 5) Escalate if severity >= critical
    const severityOrder = { info: 0, warning: 1, critical: 2 };
    if ((severityOrder[payload.severity ?? "info"] ?? 0) >= (severityOrder[ESCALATION_SEVERITY as any] ?? 2)) {
      await escalateToSuperAdmins(payload);
    }

    // await notifications to complete (non-blocking but we want basic delivery attempts)
    await Promise.allSettled(notifications);

    logger.info(`[AI:AlertMgr] Processed alert for athlete=${payload.athleteId ?? "global"} type=${payload.type}`);
    return { success: true, persisted };
  } catch (err: any) {
    logger.error("[AI:AlertMgr] Fatal error processing alert:", err?.message || err);
    return { success: false, error: err?.message ?? String(err) };
  } finally {
    // Optionally set a counter TTL if dedupe set happened
    try {
      await redis.pexpire(`${alertKey}:count`, DEDUPE_WINDOW); // ensure counter TTL matches dedupe window
    } catch { /* best-effort */ }
  }
}