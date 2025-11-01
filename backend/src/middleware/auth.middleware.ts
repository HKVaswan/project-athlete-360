/**
 * src/middleware/auth.middleware.ts
 * ------------------------------------------------------------------------
 * Enterprise-grade Authentication Middleware
 * ------------------------------------------------------------------------
 * ✅ Secure JWT verification + MFA enforcement
 * ✅ Handles impersonation safely
 * ✅ Enforces institution/subscription limits
 * ✅ Integrates audit logging and plan validation
 * ✅ Supports multi-tenant session isolation
 * ✅ Super Admin safety validation
 */

import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import logger from "../logger";
import prisma from "../prismaClient";
import {
  getUserSessionVersion,
  isTokenRevoked,
} from "../services/session.service";
import { recordAuditEvent } from "../services/audit.service";
import { Errors, ApiError } from "../utils/errors";
import { verifyMfaSession } from "../services/mfa.service";
import { ensureSuperAdmin } from "../lib/securityManager";
import { subscriptionService } from "../services/subscription.service";
import { institutionUsageRepo } from "../repositories/institutionUsage.repo";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET not configured.");
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
    institutionId?: string;
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
      throw Errors.Auth("Missing or invalid authorization header.");
    }

    const token = authHeader.split(" ")[1];
    let decoded: JwtPayload;

    try {
      decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (err) {
      logger.warn("[AUTH] Invalid/expired JWT", { ip: req.ip });
      throw Errors.Auth("Session expired or invalid token.");
    }

    // Validate session & revocation
    const [revoked, sessionVersion] = await Promise.all([
      isTokenRevoked(decoded.userId, token),
      getUserSessionVersion(decoded.userId),
    ]);

    if (revoked || sessionVersion !== decoded.sessionVersion) {
      await recordAuditEvent({
        actorId: decoded.userId,
        actorRole: decoded.role,
        action: "SECURITY_EVENT",
        details: {
          reason: "revoked_token",
          ip: req.ip,
          ua: req.get("user-agent"),
        },
      });
      throw Errors.Auth("Session revoked or replaced. Please re-login.");
    }

    // Attach user
    req.user = {
      id: decoded.userId || decoded.id,
      username: decoded.username,
      role: decoded.role,
      email: decoded.email,
      institutionId: decoded.institutionId,
      impersonatedBy: decoded.impersonatedBy,
      sessionVersion: decoded.sessionVersion || 0,
      mfaVerified: decoded.mfaVerified || false,
    };

    // ───────────────────────────────
    // 🕵️ Impersonation Tracking
    // ───────────────────────────────
    if (decoded.impersonatedBy) {
      req.isImpersonation = true;
      await recordAuditEvent({
        actorId: decoded.impersonatedBy,
        actorRole: "super_admin",
        targetId: decoded.userId,
        action: "IMPERSONATION_SESSION",
        details: {
          route: req.originalUrl,
          ip: req.ip,
          ua: req.get("user-agent"),
        },
      });
    }

    // ───────────────────────────────
    // 🔐 Enforce MFA for Super Admin
    // ───────────────────────────────
    if (decoded.role === "super_admin") {
      const validMfa =
        decoded.mfaVerified || (await verifyMfaSession(decoded.userId));
      if (!validMfa) {
        await recordAuditEvent({
          actorId: decoded.userId,
          actorRole: "super_admin",
          action: "SECURITY_EVENT",
          details: { reason: "missing_mfa", ip: req.ip },
        });
        throw Errors.Forbidden("MFA verification required for Super Admin.");
      }
    }

    // ───────────────────────────────
    // 🧩 Institution Plan & Account Check
    // ───────────────────────────────
    if (["admin", "coach", "athlete"].includes(decoded.role)) {
      const institution = await prisma.institution.findUnique({
        where: { id: decoded.institutionId },
        include: { subscription: true },
      });

      if (!institution) throw Errors.Forbidden("Institution not found.");

      // Enforce frozen/suspended states
      if (institution.status === "frozen") {
        throw Errors.Forbidden(
          "Institution account is temporarily frozen. Contact support."
        );
      }
      if (institution.status === "suspended") {
        throw Errors.Forbidden(
          "Institution account suspended due to non-payment or abuse."
        );
      }

      // Validate subscription status
      const active = await subscriptionService.validateSubscription(
        institution.id
      );
      if (!active) {
        throw Errors.Forbidden(
          "Institution subscription expired. Please renew to continue."
        );
      }

      // Prevent exceeding quota before proceeding
      const usage = await institutionUsageRepo.getUsageSummary(
        institution.id
      );
      if (usage && usage.percentUsed >= 100) {
        throw Errors.Forbidden(
          "Institution quota exceeded. Upgrade your plan to continue."
        );
      }
    }

    // ───────────────────────────────
    // 🌐 IP / Device Anomaly Detection (Optional future)
    // ───────────────────────────────
    // Future enhancement: track user device fingerprint & geo-location anomalies

    next();
  } catch (err: any) {
    logger.error("[AUTH] Middleware Error", {
      message: err.message,
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
export const requireRole =
  (roles: string[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) throw Errors.Auth("User not authenticated.");

    if (!roles.includes(req.user.role)) {
      logger.warn("[AUTH] Access denied for role", {
        role: req.user.role,
        required: roles,
        userId: req.user.id,
      });

      throw Errors.Forbidden(`Access denied. Required: ${roles.join(", ")}`);
    }

    next();
  };

// ───────────────────────────────
// 🧠 Super Admin Only
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
      throw Errors.Forbidden("Super Admin MFA verification required.");
    }

    ensureSuperAdmin(req.user.role);
    next();
  } catch (err: any) {
    logger.warn(`[AUTH] Super Admin access denied: ${err.message}`);
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json(err.toJSON());
    }
    res.status(403).json({ success: false, message: "Access denied." });
  }
};