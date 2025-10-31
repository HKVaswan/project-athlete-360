// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import logger from "../logger";
import { getUserSessionVersion, isTokenRevoked } from "../services/session.service";
import { recordAuditEvent } from "../services/audit.service";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set in environment variables.");
}

// Strong typing for authenticated requests
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: "athlete" | "coach" | "admin" | "super_admin";
    email?: string;
    impersonatedBy?: string; // if super admin impersonating
    sessionVersion?: number;
  };
  isImpersonation?: boolean;
}

// ───────────────────────────────
// 🔒 Authentication Middleware
// ───────────────────────────────
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "NO_TOKEN",
        message: "Access denied: Missing or invalid authorization header.",
      });
    }

    const token = authHeader.split(" ")[1];
    let decoded: JwtPayload;

    // Verify token integrity
    try {
      decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (err) {
      logger.warn("[AUTH] Invalid or expired token", { ip: req.ip });
      return res.status(401).json({
        success: false,
        code: "INVALID_TOKEN",
        message: "Session expired or invalid token.",
      });
    }

    // Check token revocation or version mismatch
    if (decoded.userId) {
      const isRevoked = await isTokenRevoked(decoded.userId, token);
      const sessionVersion = await getUserSessionVersion(decoded.userId);

      if (isRevoked || sessionVersion !== decoded.sessionVersion) {
        logger.info("[AUTH] Revoked or outdated token attempt", { userId: decoded.userId });
        return res.status(401).json({
          success: false,
          code: "TOKEN_REVOKED",
          message: "Session has been revoked or replaced. Please log in again.",
        });
      }
    }

    // Attach user info securely
    req.user = {
      id: decoded.userId || decoded.id,
      username: decoded.username,
      role: decoded.role,
      email: decoded.email,
      impersonatedBy: decoded.impersonatedBy || undefined,
      sessionVersion: decoded.sessionVersion || 0,
    };

    // If impersonation detected — mark request and log
    if (decoded.impersonatedBy) {
      req.isImpersonation = true;
      recordAuditEvent({
        actorId: decoded.impersonatedBy,
        actorRole: "super_admin",
        targetId: decoded.userId,
        action: "IMPERSONATION_REQUEST",
        details: {
          route: req.originalUrl,
          method: req.method,
          ip: req.ip,
          userAgent: req.get("user-agent"),
        },
      });
    }

    // Super Admin must have MFA verified
    if (decoded.role === "super_admin" && !decoded.mfaVerified) {
      return res.status(403).json({
        success: false,
        code: "MFA_REQUIRED",
        message: "Multi-Factor Authentication required for Super Admin.",
      });
    }

    next();
  } catch (err: any) {
    logger.error("[AUTH] Middleware Error", {
      message: err.message,
      stack: err.stack,
      path: req.originalUrl,
      ip: req.ip,
    });

    res.status(500).json({
      success: false,
      code: "AUTH_INTERNAL_ERROR",
      message: "Internal authentication error.",
    });
  }
};

// ───────────────────────────────
// 🧩 Optional: Role-based protection
// ───────────────────────────────
export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "User not authenticated.",
      });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn("[AUTH] Access denied for role", {
        role: req.user.role,
        required: roles,
        userId: req.user.id,
      });

      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Access denied for your role.",
      });
    }

    next();
  };
};