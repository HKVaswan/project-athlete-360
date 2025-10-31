/**
 * src/workers/superAudit.worker.ts
 * --------------------------------------------------------------------------
 * Super Audit Integrity Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Validate immutability of audit logs using hash chain
 *  - Detect suspicious admin/super_admin actions
 *  - Trigger alerts and anomaly reports
 *  - Run periodically or via Super Admin manual trigger
 * --------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import crypto from "crypto";
import { prisma } from "../prismaClient";
import { logger } from "../logger";
import { auditService } from "../services/audit.service";
import { adminNotificationService } from "../services/adminNotification.service";
import { secretManagerService } from "../services/secretManager.service";

interface SuperAuditJob {
  initiatedBy: string; // super_admin ID
  runDeepCheck?: boolean;
}

export default async function (job: Job<SuperAuditJob>) {
  logger.info(`[SUPER-AUDIT] 🕵️ Starting audit chain verification job ${job.id}`);

  try {
    const { initiatedBy, runDeepCheck = false } = job.data;

    // 🔐 Verify execution permission
    const allowedKeys = await secretManagerService.get("SUPER_AUDIT_KEYS");
    if (!allowedKeys?.includes("ENABLED")) {
      throw new Error("Super audit execution not permitted in current environment.");
    }

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, chainHash: true, previousHash: true, createdAt: true, actorId: true, actorRole: true, action: true },
    });

    if (logs.length === 0) {
      logger.warn("[SUPER-AUDIT] No audit logs found to verify.");
      return;
    }

    let brokenLinks: any[] = [];
    let suspiciousActions: any[] = [];

    // 🧩 Verify hash chain integrity
    for (let i = 1; i < logs.length; i++) {
      const prev = logs[i - 1];
      const curr = logs[i];

      const recalculatedHash = crypto
        .createHash("sha256")
        .update(JSON.stringify({ ...curr, chainHash: undefined }) + prev.chainHash)
        .digest("hex");

      if (curr.chainHash !== recalculatedHash) {
        brokenLinks.push({
          id: curr.id,
          expected: recalculatedHash,
          found: curr.chainHash,
        });
      }

      // Detect suspicious admin patterns
      if (curr.actorRole === "admin" || curr.actorRole === "super_admin") {
        if (curr.action === "ADMIN_OVERRIDE" || curr.action === "SECURITY_EVENT") {
          suspiciousActions.push(curr);
        }
      }
    }

    // 📊 Log findings
    const summary = {
      totalLogs: logs.length,
      brokenLinks: brokenLinks.length,
      suspiciousActions: suspiciousActions.length,
      runDeepCheck,
    };

    logger.info(`[SUPER-AUDIT] ✅ Chain verification completed`, summary);

    await auditService.log({
      actorId: initiatedBy,
      actorRole: "super_admin",
      action: "SYSTEM_ALERT",
      details: {
        event: "super_audit_check",
        summary,
      },
    });

    // 🚨 Alert admins if issues found
    if (brokenLinks.length > 0 || suspiciousActions.length > 0) {
      const alertMessage = `Super Audit detected ${brokenLinks.length} chain issues and ${suspiciousActions.length} suspicious actions.`;

      await adminNotificationService.broadcastAlert({
        title: "⚠️ Super Audit Integrity Alert",
        body: alertMessage,
        meta: { brokenLinks, suspiciousActions },
      });

      logger.warn(`[SUPER-AUDIT] ⚠️ Issues found and admins notified.`);
    }

    return { success: true, summary };
  } catch (err: any) {
    logger.error(`[SUPER-AUDIT] ❌ Worker failed: ${err.message}`, { stack: err.stack });
    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "SECURITY_EVENT",
      details: {
        event: "super_audit_failure",
        reason: err.message,
      },
    });
    throw err;
  }
}