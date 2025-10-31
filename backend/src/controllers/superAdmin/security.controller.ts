/**
 * src/controllers/superAdmin/system.controller.ts
 * ----------------------------------------------------------------------
 * Super Admin System Controller (Enterprise Edition)
 *
 * Responsibilities:
 *  - System metrics, backup, and health monitoring
 *  - Secure manual trigger for backup & restore
 *  - Infrastructure and AI status endpoints
 *  - Fully audited and MFA-protected
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
import crypto from "crypto";

/* -----------------------------------------------------------------------
   🧩 Utility: Validate Super Admin Access
------------------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super admin privileges required.");
  }
  if (!user.mfaVerified) {
    throw Errors.Forbidden("MFA verification required for critical operations.");
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

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "system_metrics_snapshot" },
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

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "BACKUP_RUN",
      details: { status: "initiated" },
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
   ☁️ 3. Restore from Cloud Backup (2-Step Confirmation)
------------------------------------------------------------------------*/
export const requestRestoreConfirmation = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { s3Key } = req.body;
    if (!s3Key) throw Errors.Validation("Backup key (s3Key) is required.");

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + 60_000; // 1 minute validity

    (global as any).restoreConfirmations = (global as any).restoreConfirmations || {};
    (global as any).restoreConfirmations[token] = { s3Key, expiresAt };

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "restore_request_token", s3Key },
    });

    res.json({
      success: true,
      message: "Restore confirmation token generated. Valid for 1 minute.",
      data: { token },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] requestRestoreConfirmation failed", { err });
    sendErrorResponse(res, err);
  }
};

export const restoreFromBackup = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { confirmToken } = req.body;

    const store = (global as any).restoreConfirmations || {};
    const record = store[confirmToken];

    if (!record || Date.now() > record.expiresAt) {
      throw Errors.Forbidden("Invalid or expired restore confirmation token.");
    }

    const { s3Key } = record;
    delete store[confirmToken];

    logger.warn(`[SUPERADMIN:SYSTEM] ⚠️ Restore initiated by ${superAdmin.id} from ${s3Key}`);
    await restoreFromCloudBackup(s3Key);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "restore_database", s3Key },
    });

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { restore: "completed", s3Key },
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
   📂 4. Get Backup History (Paginated)
------------------------------------------------------------------------*/
export const getBackupHistory = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);

    const [backups, total] = await Promise.all([
      prisma.systemBackup.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: { id: true, key: true, size: true, checksum: true, createdAt: true, status: true },
      }),
      prisma.systemBackup.count(),
    ]);

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "view_backup_history", count: backups.length },
    });

    res.json({
      success: true,
      data: { backups, pagination: { page, limit, total } },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] getBackupHistory failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧠 5. Check AI Subsystem Status (with Timeout)
------------------------------------------------------------------------*/
export const getAIStatus = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const start = Date.now();

    const aiResponse = await Promise.race([
      aiClient.generate("System self-test: respond OK"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("AI Timeout")), 5000)),
    ]);

    const latency = Date.now() - start;

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "ai_health_check", latency },
    });

    res.json({
      success: true,
      message: "AI subsystem responded successfully.",
      data: {
        provider: aiClient["provider"].name,
        latencyMs: latency,
        sampleResponse: String(aiResponse).slice(0, 80) + "...",
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
    const includeDetails = req.query.details === "true";

    const [users, athletes, institutions, sessions, alerts] = await Promise.all([
      prisma.user.count(),
      prisma.athlete.count(),
      prisma.institution.count(),
      prisma.session.count(),
      prisma.notification.count({ where: { type: "analyticsAlert" } }),
    ]);

    const data: any = {
      totalUsers: users,
      athletes,
      institutions,
      sessions,
      activeAlerts: alerts,
      uptimeMinutes: Math.floor(process.uptime() / 60),
      environment: process.env.NODE_ENV || "development",
    };

    if (includeDetails) {
      data.recentAdmins = await prisma.user.findMany({
        where: { role: "admin" },
        select: { id: true, username: true, email: true, createdAt: true },
        take: 5,
      });
    }

    await auditService.log({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "system_overview", includeDetails },
    });

    res.json({ success: true, data });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SYSTEM] getSystemOverview failed", { err });
    sendErrorResponse(res, err);
  }
};