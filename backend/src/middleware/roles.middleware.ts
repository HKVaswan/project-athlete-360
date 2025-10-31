// src/middleware/roles.middleware.ts
import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.middleware";
import logger from "../logger";
import { recordAuditEvent } from "../services/audit.service";
import { getDynamicPolicy } from "../services/policy.service";

// ───────────────────────────────
// 🧩 Hierarchical Role-Based Access Middleware
// ───────────────────────────────
//
// Features:
// - Role hierarchy (super_admin > admin > coach > athlete)
// - Dynamic policy fetch from DB/config
// - Fine-grained permission matching
// - Automatic audit trail logging
// - Detailed denial reasons
// ───────────────────────────────

const ROLE_HIERARCHY = ["athlete", "coach", "admin", "super_admin"];

export const requireRole = (allowedRoles: string | string[], action?: string) => {
  const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        logger.warn("[ROLE] Unauthorized access attempt (no user)", { ip: req.ip });
        return res.status(401).json({
          success: false,
          code: "NO_AUTH",
          message: "Unauthorized access — user not authenticated.",
        });
      }

      const userRole = req.user.role?.toLowerCase();
      const userId = req.user.id;

      // ── 1️⃣ Validate role hierarchy privilege
      const userRank = ROLE_HIERARCHY.indexOf(userRole);
      const minRank = Math.min(...rolesArray.map(r => ROLE_HIERARCHY.indexOf(r)));
      const hasHierarchyAccess = userRank >= minRank;

      // ── 2️⃣ Dynamic policy check (optional)
      let hasPolicyAccess = true;
      if (action) {
        try {
          const policy = await getDynamicPolicy(userRole, action);
          hasPolicyAccess = !!policy?.allowed;
        } catch (err) {
          logger.error("[ROLE] Policy fetch failed", { err, role: userRole, action });
        }
      }

      // ── 3️⃣ Evaluate combined access
      const hasAccess = hasHierarchyAccess && hasPolicyAccess && rolesArray.includes(userRole);

      if (!hasAccess) {
        const reason = !hasHierarchyAccess
          ? "Insufficient privilege level"
          : !hasPolicyAccess
          ? "Policy denied access"
          : "Unauthorized role";

        // Audit failed attempt
        await recordAuditEvent({
          actorId: userId,
          actorRole: userRole,
          action: "ACCESS_DENIED",
          targetId: null,
          details: {
            route: req.originalUrl,
            method: req.method,
            reason,
            requiredRoles: rolesArray,
            ip: req.ip,
            userAgent: req.get("user-agent"),
          },
        });

        logger.warn("[ROLE] Access denied", {
          userId,
          role: userRole,
          route: req.originalUrl,
          reason,
        });

        return res.status(403).json({
          success: false,
          code: "ACCESS_DENIED",
          message: `Forbidden: ${reason}.`,
        });
      }

      // ── 4️⃣ Audit success (optional)
      if (process.env.AUDIT_ROLE_SUCCESS === "true") {
        await recordAuditEvent({
          actorId: userId,
          actorRole: userRole,
          action: "ACCESS_GRANTED",
          targetId: null,
          details: {
            route: req.originalUrl,
            method: req.method,
            allowedRoles: rolesArray,
            ip: req.ip,
            userAgent: req.get("user-agent"),
          },
        });
      }

      next();
    } catch (err: any) {
      logger.error("[ROLE] Middleware Error", {
        message: err.message,
        stack: err.stack,
        route: req.originalUrl,
      });

      res.status(500).json({
        success: false,
        code: "ROLE_MIDDLEWARE_ERROR",
        message: "Role verification failed due to a server error.",
      });
    }
  };
};

// ───────────────────────────────
// 🔐 Utility: Check single-role privilege programmatically
// ───────────────────────────────
export const canAccess = (userRole: string, targetRole: string): boolean => {
  const userRank = ROLE_HIERARCHY.indexOf(userRole);
  const targetRank = ROLE_HIERARCHY.indexOf(targetRole);
  return userRank >= targetRank;
};