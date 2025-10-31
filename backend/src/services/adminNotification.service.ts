// src/services/adminNotification.service.ts
/**
 * adminNotification.service.ts
 * --------------------------------------------------------------------------
 * Enterprise-grade Super Admin Notification Service
 *
 * Responsibilities:
 *  - Escalate important system / security / audit / analytics alerts to
 *    super admins via multiple channels (in-app, email, push).
 *  - Integrate seamlessly with notification repository & worker system.
 *  - Prevent spam through throttling and deduplication logic.
 *  - Automatically log audit records for every admin-facing alert.
 *  - Securely supports system-originated alerts (no manual access required).
 *
 * Used by:
 *  - systemHealth.service.ts
 *  - audit.service.ts
 *  - superAdmin.controller.ts family
 *  - background workers (analytics, system, etc.)
 * --------------------------------------------------------------------------
 */

import { logger } from "../logger";
import { prisma } from "../prismaClient";
import { auditService } from "./audit.service";
import { addNotificationJob } from "../workers/notification.worker";
import { sendEmail } from "../utils/email";
import { Errors } from "../utils/errors";

/* -----------------------------------------------------------------------
   🧩 Types
------------------------------------------------------------------------*/
export interface AdminAlertOptions {
  type:
    | "SYSTEM_ALERT"
    | "SECURITY_INCIDENT"
    | "AUDIT_LOG"
    | "BACKUP_NOTICE"
    | "AI_STATUS"
    | "PERFORMANCE_ALERT"
    | "CUSTOM";
  title: string;
  body: string;
  meta?: Record<string, any>;
  priority?: "low" | "normal" | "high" | "critical";
  email?: boolean;
  push?: boolean;
  inApp?: boolean;
  actorId?: string;
  actorRole?: string;
}

/* -----------------------------------------------------------------------
   🧠 Helper: Fetch All Active Super Admins
------------------------------------------------------------------------*/
export const getSuperAdmins = async () => {
  const admins = await prisma.user.findMany({
    where: { role: "super_admin", active: true },
    select: { id: true, email: true, name: true },
  });
  if (admins.length === 0) {
    logger.warn("[ADMIN NOTIFY] ⚠️ No active super admins found!");
  }
  return admins;
};

/* -----------------------------------------------------------------------
   🔔 Core: Send Alert to All Super Admins
------------------------------------------------------------------------*/
export const notifySuperAdmins = async (options: AdminAlertOptions) => {
  const {
    type,
    title,
    body,
    meta = {},
    priority = "normal",
    email = true,
    push = true,
    inApp = true,
    actorId = "system",
    actorRole = "system",
  } = options;

  try {
    const admins = await getSuperAdmins();
    if (!admins.length) {
      throw Errors.Server("No super admins to notify.");
    }

    const channels: ("email" | "push" | "inApp")[] = [];
    if (inApp) channels.push("inApp");
    if (push) channels.push("push");
    if (email) channels.push("email");

    for (const admin of admins) {
      // Dispatch async job for reliability
      await addNotificationJob({
        type,
        recipientId: admin.id,
        title,
        body,
        channel: channels,
        meta: { ...meta, priority },
      });

      // Optional: Direct immediate email for critical events
      if (priority === "critical" && email) {
        try {
          await sendEmail(
            admin.email,
            `[URGENT] ${title}`,
            `<h3>${title}</h3><p>${body}</p><p><b>Priority:</b> ${priority.toUpperCase()}</p>`
          );
        } catch (mailErr) {
          logger.error("[ADMIN NOTIFY] Failed to send immediate email", { admin: admin.email, mailErr });
        }
      }
    }

    // Audit event
    await auditService.log({
      actorId,
      actorRole,
      action: "SYSTEM_ALERT",
      details: {
        type,
        title,
        recipients: admins.length,
        priority,
      },
    });

    logger.info(`[ADMIN NOTIFY] 📣 Alert "${title}" sent to ${admins.length} super admins`);
  } catch (err: any) {
    logger.error("[ADMIN NOTIFY] ❌ Failed to send admin alert", { err: err?.message || err });
  }
};

/* -----------------------------------------------------------------------
   🧱 Utility: Deduplication Logic (Avoid Spam)
------------------------------------------------------------------------*/
export const isRecentDuplicateAlert = async (title: string, timeframeMin = 10): Promise<boolean> => {
  const recent = await prisma.notification.findFirst({
    where: {
      title,
      createdAt: {
        gte: new Date(Date.now() - timeframeMin * 60 * 1000),
      },
      type: { in: ["SYSTEM_ALERT", "SECURITY_INCIDENT", "PERFORMANCE_ALERT"] },
    },
  });
  return !!recent;
};

/* -----------------------------------------------------------------------
   ⚡ Smart Alert Wrapper
   (auto deduplicates + categorizes + throttles)
------------------------------------------------------------------------*/
export const smartAdminAlert = async (options: AdminAlertOptions) => {
  const { title, priority = "normal" } = options;
  const isDuplicate = await isRecentDuplicateAlert(title);

  if (isDuplicate && priority !== "critical") {
    logger.info(`[ADMIN NOTIFY] 💤 Skipping duplicate alert: "${title}"`);
    return;
  }

  await notifySuperAdmins(options);
};

/* -----------------------------------------------------------------------
   🚨 Prebuilt Alerts (Reusable templates)
------------------------------------------------------------------------*/
export const AdminAlerts = {
  systemUnhealthy: async (summary: string, meta?: Record<string, any>) => {
    await smartAdminAlert({
      type: "SYSTEM_ALERT",
      title: "🚨 System Health Alert",
      body: summary,
      meta,
      priority: "critical",
    });
  },

  backupCompleted: async (key: string, size: number) => {
    await smartAdminAlert({
      type: "BACKUP_NOTICE",
      title: "💾 Backup Completed Successfully",
      body: `Backup file (${key}) created — size: ${Math.round(size / 1024 / 1024)} MB.`,
      priority: "normal",
    });
  },

  backupFailed: async (errorMsg: string) => {
    await smartAdminAlert({
      type: "BACKUP_NOTICE",
      title: "❌ Backup Failure Detected",
      body: `Automated backup failed. Error: ${errorMsg}`,
      priority: "critical",
    });
  },

  securityIncident: async (details: string, meta?: Record<string, any>) => {
    await smartAdminAlert({
      type: "SECURITY_INCIDENT",
      title: "⚠️ Security Incident Detected",
      body: details,
      meta,
      priority: "critical",
    });
  },

  aiSubsystemError: async (details: string) => {
    await smartAdminAlert({
      type: "AI_STATUS",
      title: "🤖 AI Subsystem Error",
      body: details,
      priority: "warning",
    });
  },
};

export default {
  notifySuperAdmins,
  smartAdminAlert,
  AdminAlerts,
  getSuperAdmins,
};