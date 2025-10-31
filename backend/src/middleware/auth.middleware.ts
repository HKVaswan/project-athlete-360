import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import logger from "../logger";
import { getUserSessionVersion, isTokenRevoked } from "../services/session.service";
import { recordAuditEvent } from "../services/audit.service";
import { Errors, ApiError } from "../utils/errors";
import { verifyMfaSession } from "../services/mfa.service"; // (new helper for live MFA validation)
import { ensureSuperAdmin } from "../lib/securityManager"; // ensures caller is super admin

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set in environment variables.");
}

// ───────────────────────────────
// 🔒 Authenticated Request Type
// ───────────────────────────────
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: "athlete" | "coach" | "admin" | "super_admin";
    email?: string;
    impersonatedBy?: string;
    sessionVersion?: number;
    mfaVerified?: boolean;
  };
  isImpersonation?: boolean;
}

// ───────────────────────────────
// 🔑 Authentication Middleware
// ───────────────────────────────
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw Errors.Auth("Missing or invalid authorization header");
    }

    const token = authHeader.split(" ")[1];
    let decoded: JwtPayload;

    try {
      decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (err) {
      logger.warn("[AUTH] Invalid or expired token", { ip: req.ip });
      throw Errors.Auth("Session expired or invalid token");
    }

    // Check token revocation / session invalidation
    if (decoded.userId) {
      const [revoked, sessionVersion] = await Promise.all([
        isTokenRevoked(decoded.userId, token),
        getUserSessionVersion(decoded.userId),
      ]);

      if (revoked || sessionVersion !== decoded.sessionVersion) {
        await recordAuditEvent({
          actorId: decoded.userId,
          actorRole: decoded.role,
          action: "SECURITY_EVENT",
          details: { reason: "revoked_token", ip: req.ip, ua: req.get("user-agent") },
        });
        throw Errors.Auth("Session revoked or replaced. Please log in again.");
      }
    }

    // Attach user to request
    req.user = {
      id: decoded.userId || decoded.id,
      username: decoded.username,
      role: decoded.role,
      email: decoded.email,
      impersonatedBy: decoded.impersonatedBy,
      sessionVersion: decoded.sessionVersion || 0,
      mfaVerified: decoded.mfaVerified || false,
    };

    // ───────────────────────────────
    // 🕵️ Impersonation Detection & Logging
    // ───────────────────────────────
    if (decoded.impersonatedBy) {
      req.isImpersonation = true;
      await recordAuditEvent({
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

    // ───────────────────────────────
    // 🔐 Enforce MFA for Super Admin
    // ───────────────────────────────
    if (decoded.role === "super_admin") {
      const validMfa = decoded.mfaVerified || (await verifyMfaSession(decoded.userId));
      if (!validMfa) {
        await recordAuditEvent({
          actorId: decoded.userId,
          actorRole: "super_admin",
          action: "SECURITY_EVENT",
          details: { reason: "missing_mfa", ip: req.ip },
        });
        throw Errors.Forbidden("Multi-Factor Authentication required for Super Admin access.");
      }
    }

    next();
  } catch (err: any) {
    logger.error("[AUTH] Middleware Error", {
      message: err.message,
      stack: err.stack,
      route: req.originalUrl,
      ip: req.ip,
    });

    if (err instanceof ApiError) {
      return res.status(err.statusCode).json(err.toJSON());
    }

    res.status(500).json({
      success: false,
      code: "AUTH_INTERNAL_ERROR",
      message: "Internal authentication error.",
    });
  }
};

// ───────────────────────────────
// 🧩 Role-Based Access Middleware
// ───────────────────────────────
export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw Errors.Auth("User not authenticated.");
    }

    if (!roles.includes(req.user.role)) {
      logger.warn("[AUTH] Access denied for role", {
        role: req.user.role,
        required: roles,
        userId: req.user.id,
      });

      throw Errors.Forbidden(`Access denied. Required role: ${roles.join(", ")}`);
    }

    next();
  };
};

// ───────────────────────────────
// 🧠 Super Admin Access Only
// ───────────────────────────────
export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user || req.user.role !== "super_admin") {
      throw Errors.Forbidden("Super Admin privileges required.");
    }

    if (!req.user.mfaVerified) {
      throw Errors.Forbidden("Super Admin MFA validation required.");
    }

    ensureSuperAdmin(req.user.role);
    next();
  } catch (err: any) {
    logger.warn(`[AUTH] Super Admin access denied: ${err.message}`);
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json(err.toJSON());
    }
    res.status(403).json({
      success: false,
      message: "Access denied.",
    });
  }
};