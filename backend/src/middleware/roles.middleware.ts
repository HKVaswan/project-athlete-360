import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.middleware";
import logger from "../logger";

// ───────────────────────────────
// 🧩 Role-Based Access Middleware
// ───────────────────────────────
export const requireRole = (allowedRoles: string | string[]) => {
  const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        logger.warn("Unauthorized access attempt (no user attached)", {
          ip: req.ip,
        });
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized access." });
      }

      const userRole = req.user.role?.toLowerCase();

      if (!rolesArray.includes(userRole)) {
        logger.warn("Forbidden access attempt", {
          userId: req.user.id,
          role: userRole,
          route: req.originalUrl,
        });
        return res
          .status(403)
          .json({ success: false, message: "Forbidden: insufficient permissions." });
      }

      next();
    } catch (err: any) {
      logger.error("❌ Role Middleware Error", {
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({
        success: false,
        message: "Role verification failed due to a server error.",
      });
    }
  };
};