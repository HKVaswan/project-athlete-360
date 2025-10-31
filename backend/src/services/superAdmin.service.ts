// src/services/superAdmin.service.ts
/**
 * SuperAdminService (Enterprise-grade)
 *
 * Responsibilities:
 *  - All "system-owner" (super admin) operations:
 *      * Impersonation (safe + audited)
 *      * Backups & restores orchestration
 *      * Audit reporting & anomaly detection
 *      * User lifecycle & emergency actions (force logout, role change)
 *      * System metrics & health helpers
 *
 * Notes:
 *  - All public methods expect `actor` object that identifies the caller (id+role+mfaVerified).
 *  - Methods enforce super_admin role for safety.
 *  - Uses other modules: auth service / auditService / backupClient / restoreClient / system monitor.
 */

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import { logger } from "../logger";
import { config } from "../config";
import { auditService } from "../lib/audit";
import * as backupClient from "../lib/backupClient";
import * as restoreClient from "../lib/restoreClient";
import { addNotificationJob } from "../workers/notification.worker";
import { aiCache } from "../lib/ai/aiClient"; // optional: to clear AI caches on major changes
import { runFullBackup as enqueueFullBackupJob } from "../workers/backup.worker"; // optional worker trigger
import { generateSecureToken, sha256 as localSha256 } from "../utils/crypto"; // helpers if present
import { authRepository } from "../repositories/auth.repo";
import { authRepository as _authRepo } from "../repositories/auth.repo";
import { securityManager } from "../lib/securityManager";
import { getSystemMetrics } from "../lib/systemMonitor";
import { auditService as _auditService } from "../lib/audit";

type Actor = {
  id: string;
  role: string;
  mfaVerified?: boolean;
};

const IMPERSONATION_TTL_SEC = Number(config.impersonationTtlSec ?? 60 * 15); // 15 minutes default

// get JWT secrets & options from config
const JWT_SECRET = config.jwt?.secret || process.env.JWT_SECRET;
const JWT_EXPIRES_IN = config.jwt?.expiresIn || process.env.JWT_EXPIRES_IN || "15m";

if (!JWT_SECRET) {
  logger.warn("[SUPERADMIN] JWT_SECRET missing in config. Impersonation tokens cannot be issued securely.");
}

/**
 * Internal helper: require caller is super_admin and MFA validated (if required)
 */
const assertSuperAdmin = (actor?: Actor) => {
  if (!actor) throw Errors.Auth("Actor information required");
  if (actor.role !== "super_admin")
    throw Errors.Forbidden("Super admin privileges required");
  if (config.enforceSuperAdminMfa && !actor.mfaVerified)
    throw Errors.Forbidden("Super admin must have MFA verified");
};

/**
 * Generate an impersonation access token (JWT) for `targetUser`.
 * Token contains `impersonatedBy` claim and short TTL.
 */
const createImpersonationToken = (targetUserId: string, actor: Actor) => {
  if (!JWT_SECRET) throw Errors.Server("Server misconfiguration: JWT secret missing");

  const payload = {
    userId: targetUserId,
    impersonatedBy: actor.id,
    role: "athlete", // we will not elevate role beyond target user's role; controllers should load real role
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + IMPERSONATION_TTL_SEC,
    sessionVersion: 0,
  };

  const token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS256" });
  return token;
};

class SuperAdminService {
  /**
   * Trigger a full backup synchronously (or enqueue a job)
   * actor: must be super_admin
   */
  async triggerFullBackup(actor: Actor) {
    assertSuperAdmin(actor);
    logger.info(`[SUPERADMIN] ${actor.id} requested full backup`);

    try {
      // Fast path: schedule background worker (recommended)
      // If `enqueueFullBackupJob` exists as a worker enqueuer, use it. Otherwise run synchronously.
      if (typeof enqueueFullBackupJob === "function") {
        // enqueue job in queue system - assume worker picks it up
        // We call a wrapper in workers which itself will call backupClient.runFullBackup
        // For safety we send a notification to super admin
        await addNotificationJob({
          type: "custom",
          recipientId: actor.id,
          title: "Backup scheduled",
          body: "Full backup has been scheduled and will run shortly.",
          channel: ["inApp", "email"],
        });
        // If enqueueFullBackupJob is a direct function to run pipeline, call it async
        try {
          // try enqueue; if it throws fallback to direct
          await (enqueueFullBackupJob as unknown as () => Promise<void>)();
        } catch (e) {
          logger.debug("[SUPERADMIN] enqueueFullBackupJob failed, falling back to direct run");
          await backupClient.runFullBackup();
        }
      } else {
        // direct run
        await backupClient.runFullBackup();
      }

      // audit
      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "BACKUP_RUN",
        details: { triggeredBy: actor.id },
      });

      return { success: true, message: "Backup triggered" };
    } catch (err: any) {
      logger.error("[SUPERADMIN] Backup trigger failed:", err);
      throw Errors.Server("Failed to trigger backup");
    }
  }

  /**
   * Restore a backup from cloud key. This is destructive - requires explicit confirmation.
   * actor: super_admin
   */
  async restoreFromCloud(actor: Actor, s3Key: string, confirm = false) {
    assertSuperAdmin(actor);
    if (!confirm) throw Errors.BadRequest("Restore operation requires explicit confirmation");
    logger.info(`[SUPERADMIN] ${actor.id} requested restore from S3 key: ${s3Key}`);

    try {
      // Record audit BEFORE restore (important)
      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "SYSTEM_ALERT",
        details: { message: "Restore initiated", s3Key },
      });

      // perform restore
      await restoreClient.restoreFromCloudBackup(s3Key);

      // Post-restore: invalidate caches, revoke tokens optionally
      try {
        // revoke all refresh tokens to force re-auth: (security measure after restore)
        await prisma.refreshToken.updateMany({ data: { revoked: true }, where: {} });
        logger.info("[SUPERADMIN] Revoked all refresh tokens after restore");
      } catch (e) {
        logger.warn("[SUPERADMIN] Failed to revoke refresh tokens after restore", e);
      }

      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "BACKUP_RUN",
        details: { restoredFrom: s3Key },
      });

      await addNotificationJob({
        type: "custom",
        recipientId: actor.id,
        title: "Restore completed",
        body: `Restore from ${s3Key} completed successfully.`,
        channel: ["inApp", "email"],
      });

      return { success: true, message: "Restore completed" };
    } catch (err: any) {
      logger.error("[SUPERADMIN] Cloud restore failed:", err);
      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "SYSTEM_ALERT",
        details: { message: "Restore failed", error: err.message },
      });
      throw Errors.Server("Restore failed");
    }
  }

  /**
   * List recent audit entries (super admin only).
   */
  async getRecentAudits(actor: Actor, limit = 100) {
    assertSuperAdmin(actor);
    try {
      const rows = await _auditService.getRecent(limit);
      return rows;
    } catch (err: any) {
      logger.error("[SUPERADMIN] Failed to fetch audit logs:", err);
      throw Errors.Server("Failed to fetch audit logs");
    }
  }

  /**
   * Detect anomalies using audit service heuristics.
   */
  async detectAuditAnomalies(actor: Actor) {
    assertSuperAdmin(actor);
    try {
      const suspicious = await _auditService.detectAnomalies();
      if (suspicious.length > 0) {
        // notify super admin immediately
        await addNotificationJob({
          type: "criticalAlert",
          recipientId: actor.id,
          title: "Suspicious activity detected",
          body: `${suspicious.length} suspicious audit records found.`,
          channel: ["inApp", "email"],
        });
      }
      return suspicious;
    } catch (err: any) {
      logger.error("[SUPERADMIN] Anomaly detection failed:", err);
      throw Errors.Server("Anomaly detection failed");
    }
  }

  /**
   * Create impersonation token for target user.
   * Safety:
   *  - Actor must be super_admin with MFA if enforced
   *  - Impersonation recorded in audit logs
   *  - Token TTL is intentionally short
   */
  async impersonateUser(actor: Actor, targetUserId: string) {
    assertSuperAdmin(actor);

    // verify target exists
    const user = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw Errors.NotFound("Target user not found");

    // produce token
    const token = createImpersonationToken(targetUserId, actor);

    // store a short-lived record to allow revocation / tracking
    try {
      await prisma.impersonation.create({
        data: {
          id: uuidv4(),
          actorId: actor.id,
          targetUserId,
          tokenHash: localSha256 ? localSha256(token) : token,
          expiresAt: new Date(Date.now() + IMPERSONATION_TTL_SEC * 1000),
        },
      });
    } catch (err: any) {
      logger.warn("[SUPERADMIN] Failed to persist impersonation record:", err);
      // not fatal - continue
    }

    await _auditService.log({
      actorId: actor.id,
      actorRole: "super_admin",
      action: "ADMIN_OVERRIDE",
      details: { impersonated: targetUserId, ttlSec: IMPERSONATION_TTL_SEC },
    });

    return { token, expiresInSec: IMPERSONATION_TTL_SEC };
  }

  /**
   * Revoke impersonation tokens for a given target user or actor
   */
  async revokeImpersonations(actor: Actor, options: { targetUserId?: string; actorId?: string } = {}) {
    assertSuperAdmin(actor);

    const where: any = {};
    if (options.targetUserId) where.targetUserId = options.targetUserId;
    if (options.actorId) where.actorId = options.actorId;

    try {
      const res = await prisma.impersonation.updateMany({
        where,
        data: { revoked: true },
      });

      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "ADMIN_OVERRIDE",
        details: { revokedCount: res.count, ...options },
      });

      return { success: true, revoked: res.count };
    } catch (err: any) {
      logger.error("[SUPERADMIN] Failed to revoke impersonations:", err);
      throw Errors.Server("Failed to revoke impersonations");
    }
  }

  /**
   * List users with pagination and optional filters.
   */
  async listUsers(actor: Actor, opts: { page?: number; limit?: number; role?: string } = {}) {
    assertSuperAdmin(actor);
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(200, opts.limit || 50);
    const skip = (page - 1) * limit;

    try {
      const where: any = {};
      if (opts.role) where.role = opts.role;

      const [rows, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            institutionId: true,
            active: true,
            createdAt: true,
          },
        }),
        prisma.user.count({ where }),
      ]);

      return {
        data: rows,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    } catch (err: any) {
      logger.error("[SUPERADMIN] listUsers failed:", err);
      throw Errors.Server("Failed to list users");
    }
  }

  /**
   * Update user role (promote/demote). Records audit.
   */
  async updateUserRole(actor: Actor, targetUserId: string, newRole: string) {
    assertSuperAdmin(actor);

    const allowedRoles = ["athlete", "coach", "admin", "super_admin"];
    if (!allowedRoles.includes(newRole)) throw Errors.Validation("Invalid role");

    try {
      const user = await prisma.user.update({
        where: { id: targetUserId },
        data: { role: newRole },
      });

      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "ADMIN_OVERRIDE",
        details: { target: targetUserId, newRole },
      });

      return { success: true, user: { id: user.id, role: user.role } };
    } catch (err: any) {
      logger.error("[SUPERADMIN] updateUserRole failed:", err);
      throw Errors.Server("Failed to update user role");
    }
  }

  /**
   * Deactivate a user (soft delete / disable login)
   */
  async deactivateUser(actor: Actor, targetUserId: string, reason?: string) {
    assertSuperAdmin(actor);
    try {
      await prisma.user.update({ where: { id: targetUserId }, data: { active: false } });

      // Revoke tokens
      await prisma.refreshToken.updateMany({ where: { userId: targetUserId }, data: { revoked: true } });

      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "ADMIN_OVERRIDE",
        details: { target: targetUserId, action: "deactivate", reason },
      });

      return { success: true };
    } catch (err: any) {
      logger.error("[SUPERADMIN] deactivateUser failed:", err);
      throw Errors.Server("Failed to deactivate user");
    }
  }

  /**
   * Activate previously deactivated user
   */
  async activateUser(actor: Actor, targetUserId: string) {
    assertSuperAdmin(actor);
    try {
      await prisma.user.update({ where: { id: targetUserId }, data: { active: true } });
      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "ADMIN_OVERRIDE",
        details: { target: targetUserId, action: "activate" },
      });
      return { success: true };
    } catch (err: any) {
      logger.error("[SUPERADMIN] activateUser failed:", err);
      throw Errors.Server("Failed to activate user");
    }
  }

  /**
   * Force logout (revoke refresh tokens + bump sessionVersion)
   * This prevents old JWTs tied to sessionVersion from working if you check sessionVersion in the auth middleware.
   */
  async forceLogoutUser(actor: Actor, targetUserId: string) {
    assertSuperAdmin(actor);
    try {
      await prisma.refreshToken.updateMany({ where: { userId: targetUserId }, data: { revoked: true } });
      await prisma.user.update({ where: { id: targetUserId }, data: { sessionVersion: { increment: 1 } } });

      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "SECURITY_EVENT",
        details: { target: targetUserId, action: "forceLogout" },
      });

      return { success: true };
    } catch (err: any) {
      logger.error("[SUPERADMIN] forceLogoutUser failed:", err);
      throw Errors.Server("Failed to force logout user");
    }
  }

  /**
   * Fetch system metrics snapshot
   */
  async getSystemMetrics(actor: Actor) {
    assertSuperAdmin(actor);
    try {
      const metrics = await getSystemMetrics();
      return metrics;
    } catch (err: any) {
      logger.error("[SUPERADMIN] getSystemMetrics failed:", err);
      throw Errors.Server("Failed to get system metrics");
    }
  }

  /**
   * Export audit logs to a file (s3 upload or local)
   */
  async exportAuditLogs(actor: Actor, opts: { sinceDays?: number; uploadToS3?: boolean } = {}) {
    assertSuperAdmin(actor);
    try {
      // simple: fetch recent logs (could be streaming for large exports)
      const rows = await prisma.auditLog.findMany({
        where: opts.sinceDays ? { createdAt: { gte: new Date(Date.now() - opts.sinceDays! * 24 * 3600 * 1000) } } : {},
        orderBy: { createdAt: "desc" },
      });

      // create CSV or JSON
      const exportData = JSON.stringify(rows, null, 2);
      const fileName = `audit-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const tmpPath = `/tmp/${fileName}`;
      await import("fs").then((fs) => fs.promises.writeFile(tmpPath, exportData, "utf8"));

      let uploadResult = null;
      if (opts.uploadToS3) {
        uploadResult = await backupClient.uploadBackupToCloud(tmpPath).catch(() => null);
      }

      await _auditService.log({
        actorId: actor.id,
        actorRole: "super_admin",
        action: "OTHER",
        details: { export: fileName, uploaded: !!uploadResult },
      });

      return { success: true, path: tmpPath, uploaded: !!uploadResult, uploadResult };
    } catch (err: any) {
      logger.error("[SUPERADMIN] exportAuditLogs failed:", err);
      throw Errors.Server("Failed to export audit logs");
    }
  }
}

export const superAdminService = new SuperAdminService();
export default superAdminService;