/**
 * src/middleware/adminActionApproval.middleware.ts
 * -------------------------------------------------------------------------
 * 🧩 Admin Action Approval Middleware
 *
 * Purpose:
 *  - Enforce that sensitive admin actions are pre-approved or logged.
 *  - Add dual-control workflow (admin + super_admin approval).
 *  - Maintain tamper-proof audit trails for all privileged operations.
 *
 * Features:
 *  ✅ Approval-based execution for critical actions
 *  ✅ Multi-role (Admin + Super Admin) validation
 *  ✅ Time-bound approval windows
 *  ✅ Audit integration for all actions
 *  ✅ Automatic anomaly alert on unauthorized attempts
 */

import { Request, Response, NextFunction } from "express";
import { prisma } from "../prismaClient";
import { logger } from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { recordAuditEvent } from "../services/audit.service";

/* ---------------------------------------------------------------------------
   🧠 Configuration
--------------------------------------------------------------------------- */
const APPROVAL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const SENSITIVE_ACTIONS = [
  "DELETE_USER",
  "DELETE_INSTITUTION",
  "CHANGE_SYSTEM_CONFIG",
  "BACKUP_DELETE",
  "ROLE_UPDATE",
  "ADMIN_IMPERSONATION",
  "DATA_PURGE",
];

/* ---------------------------------------------------------------------------
   🔒 Middleware: Enforce Admin Action Approval
--------------------------------------------------------------------------- */
export const requireAdminApproval = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = (req as any).user;

    // Step 1 — Ensure authenticated admin
    if (!user || !["admin", "super_admin"].includes(user.role)) {
      throw Errors.Forbidden("Admin privileges required for this operation.");
    }

    // Step 2 — Determine action key (route or provided name)
    const actionKey =
      (req.body?.actionKey || req.originalUrl.split("?")[0]).toUpperCase();

    const isSensitive = SENSITIVE_ACTIONS.includes(actionKey);
    if (!isSensitive) return next(); // non-sensitive -> proceed

    // Step 3 — Super Admins can auto-approve their actions
    if (user.role === "super_admin") {
      await recordAuditEvent({
        actorId: user.id,
        actorRole: "super_admin",
        ip: req.ip,
        action: "ADMIN_OVERRIDE",
        details: { event: "auto_approved_action", actionKey },
      });
      return next();
    }

    // Step 4 — Check if a recent approval exists for this admin + action
    const existingApproval = await prisma.adminActionApproval.findFirst({
      where: {
        adminId: user.id,
        actionKey,
        approved: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!existingApproval) {
      // Step 5 — Log pending approval request
      const expiresAt = new Date(Date.now() + APPROVAL_WINDOW_MS);

      await prisma.adminActionApproval.create({
        data: {
          adminId: user.id,
          actionKey,
          approved: false,
          expiresAt,
        },
      });

      await recordAuditEvent({
        actorId: user.id,
        actorRole: "admin",
        ip: req.ip,
        action: "SYSTEM_ALERT",
        details: {
          event: "admin_action_pending_approval",
          actionKey,
          expiresAt,
        },
      });

      return res.status(403).json({
        success: false,
        code: "APPROVAL_REQUIRED",
        message: `Action "${actionKey}" requires super admin approval.`,
        approvalWindow: `${APPROVAL_WINDOW_MS / 60000} minutes`,
      });
    }

    // Step 6 — Approval found → proceed and log execution
    await recordAuditEvent({
      actorId: user.id,
      actorRole: "admin",
      ip: req.ip,
      action: "DATA_UPDATE",
      details: {
        event: "approved_admin_action_executed",
        actionKey,
        approvedAt: existingApproval.createdAt,
      },
    });

    next();
  } catch (err: any) {
    logger.error("[ADMIN_APPROVAL] Middleware failure", { message: err.message, stack: err.stack });
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------------
   🧩 Optional Helper: Super Admin Approval Endpoint Validator
--------------------------------------------------------------------------- */
export const approveAdminAction = async (req: Request, res: Response) => {
  try {
    const superAdmin = (req as any).user;
    if (!superAdmin || superAdmin.role !== "super_admin") {
      throw Errors.Forbidden("Super admin privileges required.");
    }

    const { adminId, actionKey } = req.body;
    if (!adminId || !actionKey) {
      throw Errors.Validation("Admin ID and action key required for approval.");
    }

    const existing = await prisma.adminActionApproval.findFirst({
      where: { adminId, actionKey, approved: false },
      orderBy: { createdAt: "desc" },
    });

    if (!existing) {
      throw Errors.NotFound("No pending approval found for this action.");
    }

    const expiresAt = new Date(Date.now() + APPROVAL_WINDOW_MS);

    await prisma.adminActionApproval.update({
      where: { id: existing.id },
      data: { approved: true, approvedBy: superAdmin.id, expiresAt },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: {
        event: "admin_action_approved",
        adminId,
        actionKey,
        expiresAt,
      },
    });

    res.json({
      success: true,
      message: `✅ Action "${actionKey}" approved for admin ${adminId}.`,
      validFor: `${APPROVAL_WINDOW_MS / 60000} minutes`,
    });
  } catch (err: any) {
    logger.error("[ADMIN_APPROVAL] Approval error", { message: err.message });
    sendErrorResponse(res, err);
  }
};