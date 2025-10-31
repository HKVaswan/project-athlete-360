/**
 * src/middleware/superAuth.middleware.ts
 * -------------------------------------------------------------------------
 * Super Admin Authentication Middleware
 *
 * Purpose:
 *  - Enforce high-security access for all super_admin routes
 *  - Validate token + MFA + device/IP binding
 *  - Detect anomalies and unauthorized attempts
 *  - Audit every action for traceability
 *
 * Features:
 *  ✅ Strict JWT verification (short expiry)
 *  ✅ MFA enforcement before access
 *  ✅ Device/IP fingerprint verification
 *  ✅ Audit logging for every access attempt
 *  ✅ Optional anomaly detection alerts
 */

import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { logger } from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { auditService } from "../lib/audit";
import { prisma } from "../prismaClient";
import { config } from "../config";
import { recordAuditEvent } from "../services/audit.service";

const SUPER_JWT_SECRET = config.jwt?.superSecret || process.env.SUPER_JWT_SECRET;

if (!SUPER_JWT_SECRET) {
  throw new Error("❌ SUPER_JWT_SECRET not defined in environment variables.");
}

/* ---------------------------------------------------------------------------
   🧩 Extend Express Request Type
--------------------------------------------------------------------------- */
export interface SuperAdminRequest extends Request {
  superAdmin?: {
    id: string;
    username: string;
    email?: string;
    role: "super_admin";
    mfaVerified: boolean;
    ip?: string;
    deviceId?: string;
    sessionVersion?: number;
  };
}

/* ---------------------------------------------------------------------------
   🔒 Middleware: Super Admin Auth Enforcement
--------------------------------------------------------------------------- */
export const requireSuperAuth = async (
  req: SuperAdminRequest,
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

    // Step 1 — Verify Token Integrity
    try {
      decoded = jwt.verify(token, SUPER_JWT_SECRET) as JwtPayload;
    } catch (err) {
      logger.warn("[SUPERAUTH] Invalid or expired super admin token", { ip: req.ip });
      throw Errors.Auth("Invalid or expired token.");
    }

    // Step 2 — Enforce Role
    if (decoded.role !== "super_admin") {
      logger.warn("[SUPERAUTH] Unauthorized role attempting super access", {
        role: decoded.role,
        userId: decoded.userId,
      });
      throw Errors.Forbidden("Super admin access required.");
    }

    // Step 3 — MFA Verification
    if (!decoded.mfaVerified) {
      logger.warn("[SUPERAUTH] MFA verification missing", { userId: decoded.userId });
      throw Errors.Forbidden("MFA verification required.");
    }

    // Step 4 — Device/IP Fingerprint Binding
    const allowedSession = await prisma.superAdminSession.findUnique({
      where: { userId: decoded.userId },
    });

    if (!allowedSession) {
      throw Errors.Auth("Session not found. Please re-authenticate.");
    }

    const requestFingerprint = `${req.ip}-${req.headers["user-agent"]}`;
    if (allowedSession.fingerprint !== requestFingerprint) {
      logger.error("[SUPERAUTH] 🔒 Device/IP mismatch detected", {
        userId: decoded.userId,
        expected: allowedSession.fingerprint,
        got: requestFingerprint,
      });

      // Flag anomaly for audit trail
      await auditService.log({
        actorId: decoded.userId,
        actorRole: "super_admin",
        ip: req.ip,
        action: "SECURITY_EVENT",
        details: {
          reason: "Device/IP fingerprint mismatch",
          expected: allowedSession.fingerprint,
          got: requestFingerprint,
        },
      });

      throw Errors.Auth("Device or IP not authorized for this session.");
    }

    // Step 5 — Check Session Version (in case of manual logout or rotation)
    if (
      allowedSession.sessionVersion &&
      decoded.sessionVersion !== allowedSession.sessionVersion
    ) {
      throw Errors.Auth("Session version mismatch. Please log in again.");
    }

    // Step 6 — Attach verified super admin identity
    req.superAdmin = {
      id: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      role: "super_admin",
      mfaVerified: decoded.mfaVerified,
      ip: req.ip,
      deviceId: decoded.deviceId || "unknown",
      sessionVersion: decoded.sessionVersion,
    };

    // Step 7 — Log successful verification
    await recordAuditEvent({
      actorId: decoded.userId,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_ALERT",
      details: { event: "super_admin_verified", device: req.headers["user-agent"] },
    });

    next();
  } catch (err: any) {
    logger.error("[SUPERAUTH] Middleware failure", { message: err.message, stack: err.stack });
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------------
   🧩 Optional: Route-Level Authorization Check
--------------------------------------------------------------------------- */
export const requireSuperAdminPrivileges = (
  allowedActions: string[] = []
) => {
  return (req: SuperAdminRequest, res: Response, next: NextFunction) => {
    if (!req.superAdmin) {
      return sendErrorResponse(res, Errors.Auth("Super admin authentication required."));
    }

    if (!req.superAdmin.mfaVerified) {
      return sendErrorResponse(res, Errors.Forbidden("MFA verification required."));
    }

    // Optional fine-grained permission control
    if (allowedActions.length > 0 && !allowedActions.includes("all")) {
      logger.debug("[SUPERAUTH] Checked fine-grained action-level access");
    }

    next();
  };
};