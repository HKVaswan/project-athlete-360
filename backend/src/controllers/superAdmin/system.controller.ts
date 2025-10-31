/**
 * src/controllers/superAdmin/system.controller.ts
 * ----------------------------------------------------------------------
 * Super Admin System Controller
 *
 * Responsibilities:
 *  - System metrics, backup, and health monitoring
 *  - Secure manual trigger for backup & restore
 *  - Infrastructure and AI status endpoints
 *  - Protected with role-based super_admin access
 *  - Fully audited actions
 * ----------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { runFullBackup } from "../../lib/backupClient";
import { restoreFromCloudBackup } from "../../lib/restoreClient";
import { getSystemMetrics } from "../../lib/systemMonitor";
import { auditService } from "../../lib/audit";
import { recordAuditEvent } from "../../services/audit.service";
import { prisma } from "../../prismaClient";
import aiClient from "../../lib/ai/aiClient";

/* -----------------------------------------------------------------------
   🧩 Utility: Validate Super Admin Access
------------------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super admin privileges required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   📊 1. Get System Metrics Snapshot
------------------------------------------------------------------------*/
export const getSystemStatus = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const metrics = await getSystemMetrics();
    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "get_system_status", metrics },
    });

    res.json({
      success: true,
      message: "System metrics snapshot retrieved successfully.",
      data: metrics,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] getSystemStatus failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   💾 2. Trigger Manual Database Backup
------------------------------------------------------------------------*/
export const triggerBackup = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    logger.info(`[SUPERADMIN:SYSTEM] 🚀 Manual backup triggered by ${superAdmin.id}`);
    await runFullBackup();

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "BACKUP_RUN",
      details: { initiatedBy: superAdmin.username },
    });

    res.json({
      success: true,
      message: "Full database backup initiated successfully.",
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] Backup trigger failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ☁️ 3. Restore from Cloud Backup (with confirmation)
------------------------------------------------------------------------*/
export const restoreFromBackup = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { s3Key, confirm } = req.body;

    if (!confirm || confirm !== true) {
      throw Errors.Validation("Explicit confirmation required for restore operation.");
    }
    if (!s3Key) throw Errors.Validation("Backup key (s3Key) is required.");

    logger.warn(`[SUPERADMIN:SYSTEM] ⚠️ Restore initiated by ${superAdmin.id} from ${s3Key}`);
    await restoreFromCloudBackup(s3Key);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "restore_database", s3Key },
    });

    res.json({
      success: true,
      message: `Database successfully restored from backup: ${s3Key}`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] Restore operation failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📂 4. Get Backup History
------------------------------------------------------------------------*/
export const getBackupHistory = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const backups = await prisma.systemBackup.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        key: true,
        size: true,
        checksum: true,
        createdAt: true,
        status: true,
      },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "view_backup_history", count: backups.length },
    });

    res.json({
      success: true,
      data: backups,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] getBackupHistory failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧠 5. Check AI Subsystem Status
------------------------------------------------------------------------*/
export const getAIStatus = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const start = Date.now();
    const aiResponse = await aiClient.generate("System self-test: respond OK");
    const latency = Date.now() - start;

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "ai_health_check", latency, provider: aiClient["provider"].name },
    });

    res.json({
      success: true,
      message: "AI subsystem responded successfully.",
      data: {
        provider: aiClient["provider"].name,
        latencyMs: latency,
        sampleResponse: aiResponse.slice(0, 80) + "...",
      },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] getAIStatus failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📦 6. Get Platform Overview Summary
------------------------------------------------------------------------*/
export const getSystemOverview = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const [users, athletes, institutions, sessions, alerts] = await Promise.all([
      prisma.user.count(),
      prisma.athlete.count(),
      prisma.institution.count(),
      prisma.session.count(),
      prisma.notification.count({ where: { type: "analyticsAlert" } }),
    ]);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "system_overview" },
    });

    res.json({
      success: true,
      data: {
        totalUsers: users,
        athletes,
        institutions,
        sessions,
        activeAlerts: alerts,
        uptimeMinutes: Math.floor(process.uptime() / 60),
        environment: process.env.NODE_ENV || "development",
      },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] getSystemOverview failed", { err });
    sendErrorResponse(res, err);
  }
};