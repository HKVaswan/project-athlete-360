// src/controllers/superAdmin.controller.ts
/**
 * Super Admin Controller (Enterprise-grade)
 *
 * Responsibilities:
 *  - System-wide operations only available to Super Admins
 *  - Auditable actions (each action writes to audit logs)
 *  - Safe operations: token revocation, impersonation start/stop
 *  - Trigger backup/restore and view backup history
 *  - View system health and metrics
 *  - Manage feature flags and worker lifecycle (start/stop/inspect)
 *
 * NOTE: All routes that use these handlers MUST be protected with a middleware
 * that ensures req.user.role === 'super_admin' and MFA if required.
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import { Errors, sendErrorResponse } from "../utils/errors";
import { auditService } from "../lib/audit";
import { runFullBackup, uploadBackupToCloud } from "../lib/backupClient";
import { restoreFromCloudBackup, restoreDatabaseFromFile } from "../lib/restoreClient";
import { aiHealthCheck, aiShutdown } from "../integrations/ai.bootstrap";
import { getSystemMetrics } from "../lib/systemMonitor";
import { authRepository } from "../repositories/auth.repo";
import { notificationRepository } from "../repositories/notification.repo";
import { config } from "../config";
import { logger } from "../logger";
import { featureFlags } from "../lib/featureFlags";
import { queues, workers, checkWorkerHealth, shutdownWorkers } from "../workers";
import Analytics from "../lib/analytics";

/**
 * Helper: ensure super admin present on request
 */
const ensureSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Super admin privileges required");
  }
  return user;
};

/**
 * GET /super-admin/dashboard
 * Returns summary metrics for the system.
 */
export const dashboard = async (req: Request, res: Response) => {
  try {
    const user = ensureSuperAdmin(req);
    const metrics = await getSystemMetrics();
    const totalUsers = await prisma.user.count();
    const totalAthletes = await prisma.athlete.count();
    const pendingApprovals = await prisma.athlete.count({ where: { approved: false } });
    const pendingInvites = await prisma.invitation.count({ where: { accepted: false } });

    const payload = {
      totals: { users: totalUsers, athletes: totalAthletes, pendingApprovals, pendingInvites },
      system: metrics,
      featureFlags: featureFlags.getAll ? featureFlags.getAll() : {},
      env: config.nodeEnv || "development",
    };

    await auditService.log({
      actorId: user.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_VIEW_DASHBOARD",
      details: { snapshotAt: new Date().toISOString() },
    });

    res.json({ success: true, data: payload });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * GET /super-admin/users
 * List users (paginated)
 */
export const listUsers = async (req: Request, res: Response) => {
  try {
    ensureSuperAdmin(req);
    const page = Number(req.query.page || 1);
    const limit = Math.min(Number(req.query.limit || 50), 200);

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          institutionId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count(),
    ]);

    res.json({
      success: true,
      data: users,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * POST /super-admin/impersonate
 * Body: { targetUserId }
 * Create an impersonation token for super admin to act as the user.
 * This should be logged and require MFA/explicit consent in UI.
 */
export const impersonate = async (req: Request, res: Response) => {
  try {
    const superAdmin = ensureSuperAdmin(req);
    const { targetUserId } = req.body;
    if (!targetUserId) throw Errors.Validation("targetUserId is required");

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw Errors.NotFound("Target user not found");

    // Create short-lived impersonation JWT (include impersonator id)
    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
      {
        userId: target.id,
        username: target.username,
        role: target.role,
        impersonatedBy: superAdmin.id,
      },
      config.jwt.secret,
      { expiresIn: "15m" }
    );

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_IMPERSONATE",
      details: { targetUserId: target.id },
    });

    res.json({ success: true, data: { impersonationToken: token, expiresIn: 15 * 60 } });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * POST /super-admin/revoke-tokens
 * Body: { userId }
 * Revoke all refresh tokens for a user.
 */
export const revokeTokens = async (req: Request, res: Response) => {
  try {
    const superAdmin = ensureSuperAdmin(req);
    const { userId } = req.body;
    if (!userId) throw Errors.Validation("userId is required");

    await authRepository.revokeRefreshToken(userId);

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_REVOKE_TOKENS",
      details: { targetUserId: userId },
    });

    res.json({ success: true, message: "Tokens revoked" });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * GET /super-admin/audit
 * View audit logs (paginated). Super admin only.
 */
export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    ensureSuperAdmin(req);
    const page = Number(req.query.page || 1);
    const limit = Math.min(Number(req.query.limit || 50), 200);

    const logs = await prisma.auditLog.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    const total = await prisma.auditLog.count();

    res.json({
      success: true,
      data: logs,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * POST /super-admin/backup
 * Trigger a full backup now (async). Returns job started message.
 */
export const triggerBackup = async (req: Request, res: Response) => {
  try {
    const superAdmin = ensureSuperAdmin(req);

    // Run backup asynchronously (do not block request)
    runFullBackup().catch((e) => {
      logger.error("[SUPERADMIN] Backup pipeline failed to run", e);
    });

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_TRIGGER_BACKUP",
      details: {},
    });

    res.json({ success: true, message: "Backup started" });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * POST /super-admin/restore
 * Body: { s3Key } OR { localFilePath }
 * Trigger a restore (protected: should be allowed only for emergency).
 */
export const triggerRestore = async (req: Request, res: Response) => {
  try {
    const superAdmin = ensureSuperAdmin(req);
    const { s3Key, localFilePath } = req.body;

    if (!s3Key && !localFilePath) throw Errors.Validation("s3Key or localFilePath required");

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_TRIGGER_RESTORE",
      details: { s3Key, localFilePath },
    });

    // restore synchronously but caller should have special permission.
    if (s3Key) {
      await restoreFromCloudBackup(s3Key);
    } else {
      await restoreDatabaseFromFile(localFilePath);
    }

    res.json({ success: true, message: "Restore completed (or queued)" });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * GET /super-admin/health
 * Returns AI health, worker health and system metrics
 */
export const systemHealth = async (req: Request, res: Response) => {
  try {
    ensureSuperAdmin(req);

    const [ai, workersHealth, metrics] = await Promise.all([
      aiHealthCheck().catch((e) => ({ ok: false, error: String(e) })),
      checkWorkerHealth().catch((e) => ({ ok: false, error: String(e) })),
      getSystemMetrics().catch((e) => ({ ok: false, error: String(e) })),
    ]);

    await auditService.log({
      actorId: (req as any).user.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_VIEW_SYSTEM_HEALTH",
      details: {},
    });

    res.json({ success: true, data: { ai, workers: workersHealth, metrics } });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * POST /super-admin/feature-flags
 * Body: { flagKey, enabled }
 */
export const setFeatureFlag = async (req: Request, res: Response) => {
  try {
    const superAdmin = ensureSuperAdmin(req);
    const { flagKey, enabled, metadata } = req.body;
    if (!flagKey) throw Errors.Validation("flagKey required");

    featureFlags.set(flagKey, !!enabled, metadata || {});

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_SET_FEATURE_FLAG",
      details: { flagKey, enabled: !!enabled, metadata },
    });

    res.json({ success: true, message: "Feature flag updated", data: featureFlags.get(flagKey) });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * GET /super-admin/feature-flags
 */
export const listFeatureFlags = async (_req: Request, res: Response) => {
  try {
    ensureSuperAdmin(_req);
    res.json({ success: true, data: featureFlags.getAll ? featureFlags.getAll() : {} });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * POST /super-admin/notify
 * Private: send a system notification to a user or to all super admins
 * Body: { targetUserId?, title, body, channels? }
 */
export const sendSystemNotification = async (req: Request, res: Response) => {
  try {
    const superAdmin = ensureSuperAdmin(req);
    const { targetUserId, title, body, channels = ["inApp"] } = req.body;
    if (!title || !body) throw Errors.Validation("title and body required");

    if (targetUserId) {
      await notificationRepository.create({
        userId: targetUserId,
        type: "system",
        title,
        body,
        status: "pending",
        meta: { createdBy: superAdmin.id },
      });
    } else {
      // broadcast to super admins
      const superAdmins = await prisma.user.findMany({ where: { role: "super_admin" } });
      for (const sa of superAdmins) {
        await notificationRepository.create({
          userId: sa.id,
          type: "system",
          title,
          body,
          status: "pending",
          meta: { createdBy: superAdmin.id },
        });
      }
    }

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_CREATE_SYSTEM_NOTIFICATION",
      details: { title, targetUserId },
    });

    res.json({ success: true, message: "Notification(s) queued" });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * POST /super-admin/workers/:action
 * Body: { workerName? }  action = start | stop | restart | inspect
 * Note: actual start/stop may depend on deployment orchestration. We can
 * support graceful shutdown and health checks here.
 */
export const controlWorkers = async (req: Request, res: Response) => {
  try {
    const superAdmin = ensureSuperAdmin(req);
    const action = String(req.params.action);
    const { workerName } = req.body;

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "SUPERADMIN_CONTROL_WORKER",
      details: { action, workerName },
    });

    switch (action) {
      case "inspect": {
        const health = await checkWorkerHealth();
        return res.json({ success: true, data: health });
      }

      case "shutdown": {
        // For cluster use, this should coordinate with process manager — local graceful shutdown:
        await shutdownWorkers();
        return res.json({ success: true, message: "Workers shutdown initiated" });
      }

      default:
        throw Errors.BadRequest("Unsupported worker action");
    }
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * GET /super-admin/metrics
 * Return aggregated metrics (analytics flush)
 */
export const getMetrics = async (_req: Request, res: Response) => {
  try {
    ensureSuperAdmin(_req);
    // example telemetry: return queued analytics + featureFlag snapshot + workers health
    const workerHealth = await checkWorkerHealth();
    const systemMetrics = await getSystemMetrics();
    res.json({ success: true, data: { workerHealth, systemMetrics } });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/**
 * GET /super-admin/notifications
 * List recent system notifications
 */
export const listNotifications = async (req: Request, res: Response) => {
  try {
    ensureSuperAdmin(req);
    const page = Number(req.query.page || 1);
    const limit = Math.min(Number(req.query.limit || 50), 200);

    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where: {},
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count(),
    ]);

    res.json({ success: true, data: rows, meta: { page, limit, total } });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -------------------------------------------------------------------------- */
/* NOTE:
 * - The router that mounts these handlers should use `requireAuth` and role guard
 *   to ensure MFA and super_admin only access.
 * - Critical operations like restore must be protected by additional steps:
 *   - audit approval workflow, confirmation UI, and possible cooldown period.
 * - Consider adding async job queueing for long-running operations to avoid
 *   HTTP timeouts and to provide status updates.
 * -------------------------------------------------------------------------- */