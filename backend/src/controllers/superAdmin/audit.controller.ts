/**
 * src/controllers/superAdmin/audit.controller.ts
 * --------------------------------------------------------------------
 * Super Admin Audit Controller
 *
 * Provides secure endpoints for:
 *  - Viewing and searching audit logs
 *  - Verifying tamper-proof hash chains
 *  - Detecting anomalies or security incidents
 *  - Purging old logs (manual cleanup)
 *
 * Access: Restricted to role === "super_admin"
 * --------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { prisma } from "../../prismaClient";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { auditService } from "../../lib/audit";
import { recordAuditEvent } from "../../services/audit.service";

/* -----------------------------------------------------------------------
   🧩 Utility: Check super_admin access
------------------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super admin privileges required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   📜 1. Get Audit Logs (with pagination and filters)
------------------------------------------------------------------------*/
export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { page = 1, limit = 50, actorId, action, entity } = req.query;

    const where: any = {};
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
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "ADMIN_OVERRIDE",
      ip: req.ip,
      details: { viewedLogs: logs.length },
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
   🔍 2. Verify Tamper-Proof Hash Chain
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
   🚨 3. Detect Anomalies
------------------------------------------------------------------------*/
export const detectAnomalies = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const suspicious = await auditService.detectAnomalies();

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
   🧹 4. Purge Old Logs (Requires confirmation)
------------------------------------------------------------------------*/
export const purgeOldLogs = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { confirm, days } = req.body;

    if (!confirm || confirm !== true) {
      throw Errors.Validation("Explicit confirmation required to purge logs.");
    }

    const deleted = await auditService.purgeOldLogs(Number(days) || 90);

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "purge_old_logs", deleted, days },
    });

    res.json({
      success: true,
      message: `✅ ${deleted || 0} logs older than ${days || 90} days deleted.`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUDIT] purgeOldLogs failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🪄 5. Get Audit Summary
------------------------------------------------------------------------*/
export const getAuditSummary = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const summary = await prisma.auditLog.groupBy({
      by: ["action"],
      _count: { action: true },
    });

    const total = await prisma.auditLog.count();

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "view_audit_summary", total },
    });

    res.json({
      success: true,
      data: {
        total,
        summary: summary.map((s) => ({
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