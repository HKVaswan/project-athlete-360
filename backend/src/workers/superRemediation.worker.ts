/**
 * src/workers/superRemediation.worker.ts
 * --------------------------------------------------------------------------
 * Super Remediation Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Automatically perform containment or remediation actions
 *  - Integrate with session, token, and secret management systems
 *  - Ensure system safety during high-risk or confirmed incidents
 *
 * Key Features:
 *  - Auto user lockout & token revocation
 *  - Database or service isolation (for critical incidents)
 *  - Secure audit + notification to all Super Admins
 *  - AI-ready adaptive remediation pipeline
 * --------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import { prisma } from "../prismaClient";
import { auditService } from "../services/audit.service";
import { adminNotificationService } from "../services/adminNotification.service";
import { secretManagerService } from "../services/secretManager.service";
import { authRepository } from "../repositories/auth.repo";

interface RemediationPayload {
  incidentId: string;
  action: "lockUser" | "revokeTokens" | "rotateKeys" | "isolateService" | "globalLockdown";
  targetId?: string; // userId or service name
  initiatedBy: string; // super_admin or system
  reason: string;
}

/**
 * 🚨 Super Remediation Worker Entry Point
 */
export default async function (job: Job<RemediationPayload>) {
  const { incidentId, action, targetId, initiatedBy, reason } = job.data;
  logger.warn(`[REMEDIATION] 🚨 Executing ${action} for incident ${incidentId}`);

  try {
    switch (action) {
      case "lockUser":
        if (!targetId) throw new Error("Missing user ID for lockUser");
        await lockUser(targetId, initiatedBy, reason);
        break;

      case "revokeTokens":
        if (!targetId) throw new Error("Missing user ID for revokeTokens");
        await revokeUserTokens(targetId, initiatedBy);
        break;

      case "rotateKeys":
        await rotatePlatformKeys(initiatedBy);
        break;

      case "isolateService":
        if (!targetId) throw new Error("Missing service identifier for isolation");
        await isolateSubsystem(targetId, initiatedBy, reason);
        break;

      case "globalLockdown":
        await globalLockdown(initiatedBy);
        break;

      default:
        logger.warn(`[REMEDIATION] Unknown action: ${action}`);
        break;
    }

    // Log remediation success
    await auditService.log({
      actorId: initiatedBy,
      actorRole: "super_admin",
      action: "SECURITY_EVENT",
      details: { event: "remediation_action", incidentId, action, reason },
    });

    await prisma.systemIncident.update({
      where: { id: incidentId },
      data: { status: "remediated", remediatedAt: new Date() },
    });

    logger.info(`[REMEDIATION] ✅ ${action} executed successfully.`);
  } catch (err: any) {
    logger.error(`[REMEDIATION] ❌ ${action} failed: ${err.message}`);
    await auditService.log({
      actorId: initiatedBy,
      actorRole: "super_admin",
      action: "SECURITY_EVENT",
      details: { event: "remediation_failure", action, incidentId, error: err.message },
    });
    throw err;
  }
}

/* -----------------------------------------------------------------------
   🧩 Specific Remediation Actions
------------------------------------------------------------------------*/

/**
 * 🔒 Immediately lock a user account.
 */
async function lockUser(userId: string, initiatedBy: string, reason: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { locked: true },
  });

  await adminNotificationService.broadcastAlert({
    title: "🚫 User Account Locked",
    body: `User ${userId} was locked due to: ${reason}`,
    meta: { userId, reason },
  });

  logger.warn(`[REMEDIATION] User ${userId} locked by ${initiatedBy}`);
}

/**
 * 🪣 Revoke all active tokens for a user.
 */
async function revokeUserTokens(userId: string, initiatedBy: string) {
  await authRepository.revokeRefreshToken(userId);

  await prisma.session.deleteMany({ where: { userId } });

  await adminNotificationService.broadcastAlert({
    title: "🔐 Tokens Revoked",
    body: `All active sessions revoked for user ${userId}`,
    meta: { userId },
  });

  logger.info(`[REMEDIATION] Revoked tokens for user ${userId}`);
}

/**
 * 🔑 Rotate sensitive platform keys.
 */
async function rotatePlatformKeys(initiatedBy: string) {
  const newJwtSecret = await secretManagerService.rotate("JWT_SECRET");
  const newRefreshSecret = await secretManagerService.rotate("REFRESH_TOKEN_SECRET");

  await adminNotificationService.broadcastAlert({
    title: "🔄 Platform Keys Rotated",
    body: "JWT and Refresh Token secrets were rotated for security reasons.",
  });

  logger.warn(`[REMEDIATION] Platform keys rotated by ${initiatedBy}`);

  await auditService.log({
    actorId: initiatedBy,
    actorRole: "super_admin",
    action: "SYSTEM_ALERT",
    details: { event: "rotate_keys", newJwtSecret, newRefreshSecret },
  });
}

/**
 * 🧩 Isolate a subsystem temporarily (AI, Backup, Analytics, etc.).
 */
async function isolateSubsystem(serviceName: string, initiatedBy: string, reason: string) {
  await prisma.systemIsolation.create({
    data: {
      serviceName,
      reason,
      isolatedBy: initiatedBy,
      createdAt: new Date(),
      active: true,
    },
  });

  await adminNotificationService.broadcastAlert({
    title: "🧱 Subsystem Isolated",
    body: `Service "${serviceName}" was temporarily isolated due to: ${reason}`,
    meta: { serviceName, reason },
  });

  logger.warn(`[REMEDIATION] Service "${serviceName}" isolated by ${initiatedBy}`);
}

/**
 * 🧰 Trigger a full system lockdown (emergency mode).
 */
async function globalLockdown(initiatedBy: string) {
  await prisma.systemLockdown.create({
    data: {
      activatedBy: initiatedBy,
      createdAt: new Date(),
      active: true,
      message: "Global emergency lockdown activated. All sensitive operations halted.",
    },
  });

  await adminNotificationService.broadcastAlert({
    title: "🚨 GLOBAL LOCKDOWN ACTIVATED",
    body: "All system access has been restricted due to a critical security event.",
  });

  logger.fatal(`[REMEDIATION] 🚨 GLOBAL LOCKDOWN ACTIVATED by ${initiatedBy}`);
}