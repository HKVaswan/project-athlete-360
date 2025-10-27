// src/middleware/roles.middleware.ts
import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import logger from "../logger";

// Extend Express Request to include decoded user info
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: Role;
  };
  userId?: string;
  username?: string;
  role?: Role;
}

/**
 * 🔐 Middleware: Role-Based Access Control (RBAC)
 * Ensures the authenticated user has one of the required roles.
 * Example: router.post("/admin-only", requireRole(["admin"]), controller)
 */
export const requireRole = (roles: Role | Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Extract role from user (added via requireAuth)
      const userRole = (req.role || req.user?.role) as Role | undefined;

      if (!userRole) {
        logger.warn("[RBAC] Missing role in request");
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized: missing role" });
      }

      const allowedRoles = Array.isArray(roles) ? roles : [roles];

      // Check access permission
      if (!allowedRoles.includes(userRole)) {
        logger.warn(
          `[RBAC] Forbidden access - role=${userRole}, required=${allowedRoles.join(", ")}`
        );
        return res.status(403).json({
          success: false,
          message: `Forbidden: ${userRole} is not authorized for this action`,
        });
      }

      next();
    } catch (err) {
      logger.error(`[RBAC] Error in role middleware: ${(err as Error).message}`);
      res
        .status(500)
        .json({ success: false, message: "Internal role verification error" });
    }
  };
};

/**
 * 🚦 Utility Middlewares (Shortcut Versions)
 * Helps in quickly securing routes
 */
export const requireAdmin = requireRole("admin");
export const requireCoach = requireRole("coach");
export const requireAthlete = requireRole("athlete");