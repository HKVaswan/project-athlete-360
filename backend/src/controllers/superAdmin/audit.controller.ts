/**
 * src/controllers/superAdmin/audit.controller.ts
 * --------------------------------------------------------------------
 * 🧠 Super Admin Audit Controller — Enterprise Grade
 *
 * Responsibilities:
 *  - Secure viewing, searching, and verifying audit logs
 *  - Detect and respond to anomalies or tampering
 *  - Manage retention (purge old logs with confirmation)
 *  - Ensure every super admin action is auditable
 *
 * Access: Strictly limited to role === "super_admin"
 * --------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { prisma } from "../../prismaClient";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { auditService } from "../../services/audit.service";
import { recordAuditEvent } from "../../services/audit.service";
import { createSuperAdminAlert } from "../../services/superAdminAlerts.service";

/* -----------------------------------------------------------------------
   🧩 Require Super Admin Access
------------------------------------------------------------------------*/
function requireSuperAdmin(req: Request) {
  const user = (req as any).superAdmin || (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super admin privileges required.");
  }
  return user;
}

/* -----------------------------------------------------------------------
   📜 1️⃣ Get Audit Logs (Paginated + Filtered)
------------------------------------------------------------------------*/
export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { page = 1, limit = 50, actorId, action, entity } = req.query;

    const where: Record<string, any> = {};
    if (actorId) where.actorId = String(actorId);
    if (action) where.action = String(action);
    if (entity) where.entity = String(entity);

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
        select: {
          id: true,
          actorId: true,
          actorRole: true,
          ip: true,
          action: true,
          entity: true,
          entityId: true,
          timestamp: true,
          chainHash: true,
          previousHash: true,
          details: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "view_audit_logs", viewed: logs.length },
    });

    res.json({
      success: true,
      data: { logs, pagination: { total, page: Number(page), limit: Number(limit) } },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUDIT] Failed to fetch logs", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔍 2️⃣ Verify Tamper-Proof Hash Chain
------------------------------------------------------------------------*/
export const verifyAuditChain = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, chainHash: true, previousHash: true, action: true },
    });

    let brokenAt: string | null = null;

    for (let i = 1; i < logs.length; i++) {
      const prev = logs[i - 1];
      const current = logs[i];
      if (current.previousHash !== prev.chainHash) {
        brokenAt = current.id;
        break;
      }
    }

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: {
        event: "audit_chain_verification",
        verified: !brokenAt,
        brokenAt,
      },
    });

    if (brokenAt) {
      await createSuperAdminAlert({
        title: "⚠️ Audit Chain Integrity Breach",
        message: `Audit chain appears broken at log ID: ${brokenAt}`,
        severity: "critical",
        category: "security",
        metadata: { brokenAt },
      });
    }

    res.json({
      success: true,
      verified: !brokenAt,
      message: brokenAt
        ? `⚠️ Chain broken at log ID: ${brokenAt}`
        : "✅ All audit log chains verified successfully.",
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUDIT] Chain verification failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🚨 3️⃣ Detect Anomalies
------------------------------------------------------------------------*/
export const detectAnomalies = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const suspicious = await auditService.detectSuspicious();

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: {
        event: "anomaly_scan",
        suspiciousCount: suspicious.length,
      },
    });

    if (suspicious.length > 0) {
      await createSuperAdminAlert({
        title: "🚨 Audit Anomaly Detected",
        message: `${suspicious.length} suspicious activities found.`,
        severity: "high",
        category: "audit",
        metadata: suspicious,
      });
    }

    res.json({
      success: true,
      message: `${suspicious.length} suspicious activities detected.`,
      data: suspicious,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUDIT] detectAnomalies failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧹 4️⃣ Purge Old Logs (Super Admin Confirmation Required)
------------------------------------------------------------------------*/
export const purgeOldLogs = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { confirm, days } = req.body;

    if (!confirm || confirm !== true) {
      throw Errors.Validation("Explicit confirmation required to purge logs.");
    }

    const retentionDays = Number(days) || 90;
    const deletedCount = await auditService.purgeOld(retentionDays, superAdmin);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "purge_old_logs", deletedCount, retentionDays },
    });

    await createSuperAdminAlert({
      title: "🧹 Audit Log Purge Executed",
      message: `${deletedCount} logs older than ${retentionDays} days purged.`,
      severity: "medium",
      category: "audit",
    });

    res.json({
      success: true,
      message: `✅ ${deletedCount} logs older than ${retentionDays} days deleted.`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUDIT] purgeOldLogs failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📊 5️⃣ Get Audit Summary (for dashboard metrics)
------------------------------------------------------------------------*/
export const getAuditSummary = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const [summary, total] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ["action"],
        _count: { action: true },
      }),
      prisma.auditLog.count(),
    ]);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "view_audit_summary", total },
    });

    res.json({
      success: true,
      data: {
        total,
        breakdown: summary.map((s) => ({
          action: s.action,
          count: s._count.action,
        })),
      },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUDIT] getAuditSummary failed", { err });
    sendErrorResponse(res, err);
  }
};