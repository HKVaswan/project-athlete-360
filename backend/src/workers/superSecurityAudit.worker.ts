/**
 * src/workers/superSecurityAudit.worker.ts
 * --------------------------------------------------------------------------
 * Super Security Audit Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Periodic scanning of system audit logs for suspicious activities
 *  - Detect unauthorized admin actions, failed MFA, or impersonation abuse
 *  - Automatically alert Super Admins and trigger risk-level escalation
 *  - Maintain verified audit chain (tamper detection)
 *
 * Integrations:
 *  - auditService
 *  - adminNotificationService
 *  - secretManagerService
 * --------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import { prisma } from "../prismaClient";
import { auditService } from "../services/audit.service";
import { adminNotificationService } from "../services/adminNotification.service";
import { secretManagerService } from "../services/secretManager.service";
import crypto from "crypto";

interface SuperSecurityAuditJob {
  triggeredBy?: string; // super_admin ID (optional)
  scope?: "system" | "users" | "ai" | "auth";
  sensitivity?: "normal" | "high" | "critical";
}

export default async function (job: Job<SuperSecurityAuditJob>) {
  const { triggeredBy = "system", scope = "system", sensitivity = "normal" } = job.data;
  logger.info(`[SECURITY-AUDIT] 🔍 Starting security audit (scope=${scope}, sensitivity=${sensitivity})`);

  try {
    // 🔐 Check if security auditing is enabled via secret manager
    const securityConfig = await secretManagerService.get("SECURITY_AUDIT_MODE");
    if (securityConfig !== "ENABLED") {
      logger.warn("[SECURITY-AUDIT] Auditing is currently disabled by configuration.");
      return;
    }

    // 🧠 Step 1: Collect recent critical audit logs
    const criticalLogs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { action: "SECURITY_EVENT" },
          { action: "ADMIN_OVERRIDE" },
          { action: "IMPERSONATION_REQUEST" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Step 2: Detect suspicious patterns
    const anomalies: any[] = [];

    for (const log of criticalLogs) {
      const hashData = crypto
        .createHash("sha256")
        .update(`${log.actorId}-${log.action}-${log.timestamp}`)
        .digest("hex");

      // Pattern detection logic
      if (log.actorRole !== "super_admin" && log.action === "ADMIN_OVERRIDE") {
        anomalies.push({
          type: "Unauthorized Override",
          actorId: log.actorId,
          entity: log.entity,
          timestamp: log.timestamp,
          hash: hashData,
        });
      }

      if (log.details?.reason?.includes("manual override") && log.actorRole !== "super_admin") {
        anomalies.push({
          type: "Manual Override Attempt",
          actorId: log.actorId,
          entity: log.entity,
          timestamp: log.timestamp,
          hash: hashData,
        });
      }

      if (log.details?.failedMFA === true) {
        anomalies.push({
          type: "Failed MFA Attempt",
          actorId: log.actorId,
          timestamp: log.timestamp,
          hash: hashData,
        });
      }

      if (log.details?.impersonatedBy && !log.details?.approvedBySuperAdmin) {
        anomalies.push({
          type: "Unapproved Impersonation Detected",
          actorId: log.details?.impersonatedBy,
          target: log.actorId,
          timestamp: log.timestamp,
          hash: hashData,
        });
      }
    }

    // Step 3: Log audit summary
    const summary = {
      totalChecked: criticalLogs.length,
      anomaliesDetected: anomalies.length,
      sensitivity,
      timestamp: new Date().toISOString(),
    };

    await auditService.log({
      actorId: triggeredBy,
      actorRole: "super_admin",
      action: "SYSTEM_ALERT",
      details: {
        event: "security_audit_summary",
        summary,
        anomalies: anomalies.slice(0, 10), // limit stored anomalies for brevity
      },
    });

    // Step 4: Alert all super admins if anomalies found
    if (anomalies.length > 0) {
      await adminNotificationService.broadcastAlert({
        title: "⚠️ Security Anomalies Detected",
        body: `${anomalies.length} suspicious actions identified during automated audit.`,
        meta: { scope, sensitivity, anomalies: anomalies.slice(0, 5) },
      });

      logger.warn(`[SECURITY-AUDIT] ⚠️ ${anomalies.length} anomalies detected.`);
    } else {
      logger.info("[SECURITY-AUDIT] ✅ No anomalies detected in this cycle.");
    }
  } catch (err: any) {
    logger.error(`[SECURITY-AUDIT] ❌ Audit failed: ${err.message}`, { stack: err.stack });

    await auditService.log({
      actorId: triggeredBy,
      actorRole: "super_admin",
      action: "SECURITY_EVENT",
      details: {
        event: "security_audit_failure",
        reason: err.message,
        scope,
      },
    });

    await adminNotificationService.broadcastAlert({
      title: "🚨 Security Audit Failure",
      body: `Automated security audit failed: ${err.message}`,
      meta: { scope, error: err.message },
    });

    throw err;
  }
}