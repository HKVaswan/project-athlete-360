/**
 * src/controllers/superAdmin/userManagement.controller.ts
 * ------------------------------------------------------------------------
 * Super Admin User Management Controller
 *
 * Responsibilities:
 *  - Manage all users and system roles
 *  - Suspend, reactivate, or delete accounts (with safeguards)
 *  - Secure impersonation with audit tracking
 *  - Prevent privilege escalation or abuse
 *  - Ensure every action is auditable and reversible
 * ------------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { recordAuditEvent } from "../../services/audit.service";
import jwt from "jsonwebtoken";
import { config } from "../../config";

/* -----------------------------------------------------------------------
   🧩 Helper: Verify Super Admin
------------------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super Admin privileges required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   👥 1. List All Users
------------------------------------------------------------------------*/
export const listUsers = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const { role, search, limit = 50 } = req.query;

    const where: any = {};
    if (role) where.role = role;
    if (search)
      where.OR = [
        { username: { contains: String(search), mode: "insensitive" } },
        { email: { contains: String(search), mode: "insensitive" } },
      ];

    const users = await prisma.user.findMany({
      where,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "USER_LIST_VIEW",
      details: { count: users.length, filter: where },
    });

    res.json({
      success: true,
      message: "User list retrieved successfully.",
      data: users,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] listUsers failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🚫 2. Suspend a User
------------------------------------------------------------------------*/
export const suspendUser = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { userId, reason } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.NotFound("User not found");

    if (user.role === "super_admin")
      throw Errors.Forbidden("Super Admin accounts cannot be suspended.");

    await prisma.user.update({
      where: { id: userId },
      data: { suspended: true },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      targetId: userId,
      action: "USER_SUSPENDED",
      details: { reason },
    });

    res.json({
      success: true,
      message: `User ${user.username} has been suspended.`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] suspendUser failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔄 3. Reactivate a User
------------------------------------------------------------------------*/
export const reactivateUser = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { userId } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.NotFound("User not found");

    await prisma.user.update({
      where: { id: userId },
      data: { suspended: false },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      targetId: userId,
      action: "USER_REACTIVATED",
    });

    res.json({
      success: true,
      message: `User ${user.username} has been reactivated.`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] reactivateUser failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ⚙️ 4. Change User Role
------------------------------------------------------------------------*/
export const changeUserRole = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { userId, newRole } = req.body;

    if (!["athlete", "coach", "admin"].includes(newRole)) {
      throw Errors.Validation("Invalid role specified.");
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.NotFound("User not found");

    if (user.role === "super_admin")
      throw Errors.Forbidden("Cannot change role of another Super Admin.");

    await prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      targetId: userId,
      action: "USER_ROLE_CHANGED",
      details: { from: user.role, to: newRole },
    });

    res.json({
      success: true,
      message: `User ${user.username}'s role changed to ${newRole}.`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] changeUserRole failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🕵️ 5. Impersonate User (Securely)
------------------------------------------------------------------------*/
export const impersonateUser = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { userId } = req.body;

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) throw Errors.NotFound("Target user not found");

    if (targetUser.role === "super_admin")
      throw Errors.Forbidden("Cannot impersonate another Super Admin.");

    const token = jwt.sign(
      {
        userId: targetUser.id,
        username: targetUser.username,
        role: targetUser.role,
        impersonatedBy: superAdmin.id,
        mfaVerified: true,
      },
      config.jwt.secret,
      { expiresIn: "1h" }
    );

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      targetId: targetUser.id,
      action: "USER_IMPERSONATION_START",
      details: { targetRole: targetUser.role },
    });

    res.json({
      success: true,
      message: `Impersonation token generated for ${targetUser.username}`,
      data: { token },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] impersonateUser failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ❌ 6. Delete User (With Soft Delete Option)
------------------------------------------------------------------------*/
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { userId, softDelete = true } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.NotFound("User not found");

    if (user.role === "super_admin")
      throw Errors.Forbidden("Super Admin account cannot be deleted.");

    if (softDelete) {
      await prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), active: false },
      });
    } else {
      await prisma.user.delete({ where: { id: userId } });
    }

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      targetId: userId,
      action: "USER_DELETED",
      details: { mode: softDelete ? "soft" : "hard" },
    });

    res.json({
      success: true,
      message: `User ${user.username} has been ${softDelete ? "soft" : "hard"} deleted.`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] deleteUser failed", { err });
    sendErrorResponse(res, err);
  }
};