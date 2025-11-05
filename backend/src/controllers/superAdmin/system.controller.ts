/**
 * src/controllers/superAdmin/system.controller.ts
 * ----------------------------------------------------------------------
 * 🧠 Super Admin System Controller (Enterprise v2)
 *
 * Responsibilities:
 *  - System metrics, backup, and health monitoring
 *  - Manual backup / restore (with audit, confirmation, and safeguards)
 *  - Infrastructure, AI, and service health diagnostics
 *  - Role-based access control for Super Admins
 *  - Fully auditable via Audit Service
 * ----------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { runFullBackup } from "../../lib/backupClient";
import { restoreFromCloudBackup } from "../../lib/restoreClient";
import { getSystemMetrics } from "../../lib/systemMonitor";
import { recordAuditEvent } from "../../services/audit.service";
import { backupMonitorService } from "../../services/backupMonitor.service";
import { prisma } from "../../prismaClient";
import aiClient from "../../lib/ai/aiClient";
import { superAdminAlertsService } from "../../services/superAdminAlerts.service";

/* -----------------------------------------------------------------------
   🧩 Access Guard
------------------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super admin privileges required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   📊 1️⃣ Get Real-Time System Metrics Snapshot
------------------------------------------------------------------------*/
export const getSystemStatus = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const metrics = await getSystemMetrics();

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_METRICS_VIEWED",
      details: { metrics },
    });

    res.json({
      success: true,
      message: "System metrics snapshot retrieved successfully.",
      data: metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error("[SYSTEM] getSystemStatus failed", err);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   💾 2️⃣ Trigger Manual Full Backup (with audit)
------------------------------------------------------------------------*/
export const triggerBackup = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    logger.info(`[SYSTEM] 🚀 Manual backup triggered by ${superAdmin.username}`);
    await runFullBackup();

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "MANUAL_BACKUP_TRIGGERED",
      details: { initiatedBy: superAdmin.username },
    });

    await superAdminAlertsService.dispatchSuperAdminAlert({
      title: "Manual Backup Initiated",
      message: `Backup triggered manually by ${superAdmin.username}.`,
      category: "backup",
      severity: "medium",
    });

    res.json({
      success: true,
      message: "✅ Database backup initiated successfully.",
    });
  } catch (err: any) {
    logger.error("[SYSTEM] Manual backup failed", err);
    await superAdminAlertsService.dispatchSuperAdminAlert({
      title: "Backup Failure",
      message: `Manual backup failed: ${err.message}`,
      category: "backup",
      severity: "high",
    });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ☁️ 3️⃣ Secure Restore from Cloud Backup
------------------------------------------------------------------------*/
export const restoreFromBackup = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { s3Key, confirm, dryRun } = req.body;

    if (!confirm) {
      throw Errors.Validation("Restore requires explicit confirmation (confirm: true).");
    }
    if (!s3Key) throw Errors.Validation("Missing parameter: s3Key.");

    // Rate limit restores for safety
    const recentRestore = await prisma.auditLog.findFirst({
      where: {
        action: "ADMIN_RESTORE_TRIGGERED",
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
    if (recentRestore) {
      throw Errors.TooManyRequests("Restore can only be triggered once every 10 minutes.");
    }

    logger.warn(`[SYSTEM] ⚠️ Restore initiated by ${superAdmin.username} from ${s3Key}`);
    await restoreFromCloudBackup(s3Key, superAdmin.role);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_RESTORE_TRIGGERED",
      details: { s3Key, dryRun: !!dryRun },
    });

    await superAdminAlertsService.dispatchSuperAdminAlert({
      title: "Database Restored",
      message: `Database successfully restored from backup ${s3Key} by ${superAdmin.username}.`,
      category: "backup",
      severity: "critical",
    });

    res.json({
      success: true,
      message: `Database restore completed from: ${s3Key}`,
    });
  } catch (err: any) {
    logger.error("[SYSTEM] Restore operation failed", err);
    await superAdminAlertsService.dispatchSuperAdminAlert({
      title: "Restore Failure",
      message: `Restore operation failed: ${err.message}`,
      category: "backup",
      severity: "critical",
    });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧾 4️⃣ Retrieve Backup History and Health Insights
------------------------------------------------------------------------*/
export const getBackupHistory = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const backups = await backupMonitorService.getRecentBackupHistory(20);
    const health = await backupMonitorService.getBackupHealthSummary();

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "VIEW_BACKUP_HISTORY",
      details: { count: backups.length },
    });

    res.json({
      success: true,
      message: "Backup history and health overview retrieved successfully.",
      data: { backups, health },
    });
  } catch (err: any) {
    logger.error("[SYSTEM] getBackupHistory failed", err);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧠 5️⃣ AI Subsystem Self-Test
------------------------------------------------------------------------*/
export const getAIStatus = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const start = Date.now();
    const aiResponse = await aiClient.generate("System self-test: respond 'OK'");
    const latency = Date.now() - start;

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "AI_SUBSYSTEM_CHECK",
      details: { provider: aiClient["provider"].name, latency },
    });

    res.json({
      success: true,
      message: "AI subsystem operational.",
      data: {
        provider: aiClient["provider"].name,
        latencyMs: latency,
        sampleResponse: aiResponse.slice(0, 100) + "...",
      },
    });
  } catch (err: any) {
    logger.error("[SYSTEM] AI health check failed", err);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📦 6️⃣ Platform Overview Dashboard Summary
------------------------------------------------------------------------*/
export const getSystemOverview = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const [users, athletes, institutions, sessions, alerts] = await Promise.all([
      prisma.user.count(),
      prisma.athlete.count(),
      prisma.institution.count(),
      prisma.session.count(),
      prisma.systemAlert.count({ where: { status: "open" } }),
    ]);

    const uptimeMinutes = Math.floor(process.uptime() / 60);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_OVERVIEW_VIEWED",
      details: { uptimeMinutes, environment: process.env.NODE_ENV },
    });

    res.json({
      success: true,
      message: "System overview fetched successfully.",
      data: {
        totalUsers: users,
        totalAthletes: athletes,
        institutions,
        sessions,
        activeAlerts: alerts,
        uptimeMinutes,
        environment: process.env.NODE_ENV,
      },
    });
  } catch (err: any) {
    logger.error("[SYSTEM] getSystemOverview failed", err);
    sendErrorResponse(res, err);
  }
};