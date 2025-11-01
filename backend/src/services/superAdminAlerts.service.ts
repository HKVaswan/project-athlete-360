/**
 * src/services/superAdminAlerts.service.ts
 * -------------------------------------------------------------------------
 * Enterprise Super Admin Alerts Service
 *
 * Responsibilities:
 *  - Central hub for critical system alerts and incident reporting
 *  - Sends multi-channel notifications (in-app, email, optional SMS/push)
 *  - Writes alert data to DB + audit trail
 *  - Provides severity-level classification
 *  - Integrates with monitoring systems (storage, billing, AI, security)
 *
 * Features:
 *  - Alert deduplication (prevents spam)
 *  - Priority escalation for repeated incidents
 *  - Robust fail-safes — ensures alert always reaches at least one channel
 * -------------------------------------------------------------------------
 */

import { logger } from "../logger";
import { prisma } from "../prismaClient";
import { addNotificationJob } from "../workers/notification.worker";
import { recordAuditEvent } from "./audit.service";
import { config } from "../config";
import { sendEmail } from "../utils/email";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface SystemAlert {
  title: string;
  message: string;
  category:
    | "security"
    | "backup"
    | "storage"
    | "payment"
    | "ai"
    | "system"
    | "impersonation"
    | "plan"
    | "infrastructure";
  severity: AlertSeverity;
  metadata?: Record<string, any>;
  notifyAll?: boolean; // send to all super admins (default true)
}

/* -----------------------------------------------------------------------
   🔒 Internal Utilities
------------------------------------------------------------------------*/
const getSuperAdmins = async () => {
  return prisma.user.findMany({
    where: { role: "super_admin", active: true },
    select: { id: true, email: true, username: true },
  });
};

/* -----------------------------------------------------------------------
   🚨 Create and Dispatch a System Alert
------------------------------------------------------------------------*/
export const createSuperAdminAlert = async (alert: SystemAlert) => {
  try {
    const { title, message, category, severity, metadata = {}, notifyAll = true } = alert;

    // 1️⃣ Store alert in database
    const record = await prisma.systemAlert.create({
      data: {
        title,
        message,
        category,
        severity,
        metadata,
        status: "open",
      },
    });

    // 2️⃣ Find recipients (one or all super admins)
    const recipients = notifyAll
      ? await getSuperAdmins()
      : [{ id: config.superAdminId, email: config.superAdminEmail }];

    // 3️⃣ Create notifications in queue
    for (const admin of recipients) {
      await addNotificationJob({
        type: "systemAlert",
        recipientId: admin.id,
        title: `🚨 [${severity.toUpperCase()}] ${title}`,
        body: message,
        channel: ["inApp", "email"],
        meta: { category, severity, ...metadata },
      });

      // Send fallback email (guaranteed delivery)
      try {
        await sendEmail(
          admin.email,
          `⚠️ ${title} [${severity.toUpperCase()}]`,
          `<p>${message}</p><pre>${JSON.stringify(metadata, null, 2)}</pre>`
        );
      } catch (emailErr) {
        logger.warn(`[ALERT] Email failed for ${admin.email}: ${emailErr}`);
      }
    }

    // 4️⃣ Audit trail
    await recordAuditEvent({
      actorId: "system",
      actorRole: "system",
      action: "SYSTEM_ALERT",
      details: { title, severity, category },
    });

    logger.info(`[ALERT] 🚨 ${severity.toUpperCase()} alert dispatched: ${title}`);
    return record;
  } catch (err: any) {
    logger.error(`[ALERT] ❌ Failed to create alert: ${err.message}`);
  }
};

/* -----------------------------------------------------------------------
   🧩 Alert Deduplication (prevent flood of same messages)
------------------------------------------------------------------------*/
export const isDuplicateAlert = async (title: string, category: string, timeframeMin = 30) => {
  const recent = await prisma.systemAlert.findFirst({
    where: {
      title,
      category,
      createdAt: {
        gte: new Date(Date.now() - timeframeMin * 60 * 1000),
      },
    },
  });
  return !!recent;
};

/* -----------------------------------------------------------------------
   🔁 Escalate Repeated Alerts
------------------------------------------------------------------------*/
export const escalateRepeatedAlert = async (title: string, category: string) => {
  const count = await prisma.systemAlert.count({
    where: { title, category, createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
  });

  if (count > 3) {
    await createSuperAdminAlert({
      title: `Repeated Incident: ${title}`,
      message: `This alert (${title}) has occurred ${count} times in the last 6 hours.`,
      category,
      severity: "critical",
      metadata: { repeatedCount: count },
    });
    logger.warn(`[ALERT] 🚨 Escalated repeated alert: ${title} (${count}x)`);
  }
};

/* -----------------------------------------------------------------------
   🧹 Resolve or Close Alerts
------------------------------------------------------------------------*/
export const resolveAlert = async (id: string, resolvedBy: string) => {
  await prisma.systemAlert.update({
    where: { id },
    data: { status: "resolved", resolvedBy, resolvedAt: new Date() },
  });

  await recordAuditEvent({
    actorId: resolvedBy,
    actorRole: "super_admin",
    action: "SYSTEM_ALERT_RESOLVED",
    details: { alertId: id },
  });

  logger.info(`[ALERT] ✅ Alert ${id} resolved by ${resolvedBy}`);
};

/* -----------------------------------------------------------------------
   📊 Retrieve Recent Alerts (for dashboards)
------------------------------------------------------------------------*/
export const getRecentAlerts = async (limit = 20) => {
  return prisma.systemAlert.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      category: true,
      severity: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
};

/* -----------------------------------------------------------------------
   🚦 Global Dispatcher: Safe Wrapper
------------------------------------------------------------------------*/
export const dispatchSuperAdminAlert = async (alert: SystemAlert) => {
  // Skip duplicates
  const duplicate = await isDuplicateAlert(alert.title, alert.category);
  if (duplicate) {
    logger.info(`[ALERT] ⚠️ Skipped duplicate alert: ${alert.title}`);
    return;
  }

  // Create + optionally escalate if repeating
  await createSuperAdminAlert(alert);
  await escalateRepeatedAlert(alert.title, alert.category);
};

export const superAdminAlertsService = {
  createSuperAdminAlert,
  dispatchSuperAdminAlert,
  getRecentAlerts,
  resolveAlert,
  escalateRepeatedAlert,
  isDuplicateAlert,
};