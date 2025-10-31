/**
 * src/controllers/superAdmin/userManagement.controller.ts
 * ----------------------------------------------------------------------
 * Super Admin User Management Controller
 *
 * Responsibilities:
 *  - Manage user accounts and roles
 *  - Suspend/reactivate users securely
 *  - Impersonate any user (for support/audit)
 *  - View system-wide role statistics
 *  - Fully auditable and access-controlled
 * ----------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { recordAuditEvent } from "../../services/audit.service";
import { revokeRefreshToken } from "../../services/auth.service";
import jwt from "jsonwebtoken";
import { config } from "../../config";

/* -----------------------------------------------------------------------
   🧩 Utility: Super Admin validation
------------------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super Admin privileges required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   📋 1. Get all users (with filters)
------------------------------------------------------------------------*/
export const listUsers = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { role, search, page = 1, limit = 20 } = req.query;

    const where: any = {};
    if (role) where.role = role;
    if (search)
      where.OR = [
        { username: { contains: String(search), mode: "insensitive" } },
        { email: { contains: String(search), mode: "insensitive" } },
      ];

    const users = await prisma.user.findMany({
      where,
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        name: true,
        createdAt: true,
        isSuspended: true,
      },
    });

    const total = await prisma.user.count({ where });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "list_users", filters: { role, search, page, limit } },
    });

    res.json({
      success: true,
      data: { users, total },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] listUsers failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🛡 2. Update user role (promotion/demotion)
------------------------------------------------------------------------*/
export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { userId, newRole } = req.body;

    if (!userId || !newRole) throw Errors.Validation("userId and newRole are required.");
    if (!["athlete", "coach", "admin", "super_admin"].includes(newRole)) {
      throw Errors.Validation("Invalid target role.");
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.NotFound("User not found.");

    if (user.role === "super_admin" && superAdmin.id !== user.id) {
      throw Errors.Forbidden("Cannot modify another Super Admin's role.");
    }

    await prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "update_user_role", userId, from: user.role, to: newRole },
    });

    logger.info(`[SUPERADMIN:USER] Role updated for ${user.username} → ${newRole}`);

    res.json({
      success: true,
      message: `User role updated to ${newRole}`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] updateUserRole failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🚫 3. Suspend or Reactivate User
------------------------------------------------------------------------*/
export const toggleUserSuspension = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { userId, suspend } = req.body;

    if (typeof suspend !== "boolean") {
      throw Errors.Validation("Missing or invalid 'suspend' flag.");
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.NotFound("User not found.");

    if (user.role === "super_admin" && suspend) {
      throw Errors.Forbidden("Cannot suspend a Super Admin account.");
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isSuspended: suspend },
    });

    if (suspend) {
      await revokeRefreshToken(user.id);
    }

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: suspend ? "suspend_user" : "reactivate_user", userId },
    });

    logger.info(`[SUPERADMIN:USER] ${suspend ? "Suspended" : "Reactivated"} user ${user.username}`);

    res.json({
      success: true,
      message: `User ${suspend ? "suspended" : "reactivated"} successfully.`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] toggleUserSuspension failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧍‍♂️ 4. Impersonate User (for debugging/audit)
------------------------------------------------------------------------*/
export const impersonateUser = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { targetUserId } = req.body;

    if (!targetUserId) throw Errors.Validation("Target user ID is required.");

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) throw Errors.NotFound("Target user not found.");

    if (targetUser.role === "super_admin") {
      throw Errors.Forbidden("Cannot impersonate another Super Admin.");
    }

    const accessToken = jwt.sign(
      {
        userId: targetUser.id,
        username: targetUser.username,
        role: targetUser.role,
        impersonatedBy: superAdmin.id,
        mfaVerified: true,
      },
      config.jwt.secret,
      { expiresIn: "30m" }
    );

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "impersonate_user", targetUserId },
    });

    logger.warn(`[SUPERADMIN:USER] ${superAdmin.username} impersonated ${targetUser.username}`);

    res.json({
      success: true,
      message: `Impersonation token issued for ${targetUser.username}`,
      data: { accessToken },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] impersonateUser failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📊 5. Get Role Distribution Stats
------------------------------------------------------------------------*/
export const getRoleDistribution = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const roles = await prisma.user.groupBy({
      by: ["role"],
      _count: { role: true },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "role_distribution" },
    });

    res.json({
      success: true,
      data: roles.map((r) => ({ role: r.role, count: r._count.role })),
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:USER] getRoleDistribution failed", { err });
    sendErrorResponse(res, err);
  }
};