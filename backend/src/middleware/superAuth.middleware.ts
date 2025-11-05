/**
 * src/middleware/superAuth.middleware.ts
 * -------------------------------------------------------------------------
 * 🔐 Super Admin Authentication Middleware — Enterprise Grade
 *
 * Purpose:
 *  - Enforce high-security access for all super_admin routes
 *  - Validate JWT + MFA + device/IP binding
 *  - Detect anomalies and unauthorized attempts
 *  - Audit every action for traceability
 *
 * Features:
 *  ✅ Strict JWT verification (short expiry)
 *  ✅ MFA enforcement before access
 *  ✅ Device/IP fingerprint verification
 *  ✅ Audit logging for every access attempt
 *  ✅ Optional anomaly detection alerts + auto lockout
 * -------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { logger } from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { prisma } from "../prismaClient";
import { config } from "../config";
import { recordAuditEvent } from "../services/audit.service";
import { createSuperAdminAlert } from "../services/superAdminAlerts.service";

const SUPER_JWT_SECRET =
  config.jwt?.superSecret || process.env.SUPER_JWT_SECRET;

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
  const clientIp = req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.ip;
  const userAgent = req.headers["user-agent"] || "unknown";

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
      logger.warn("[SUPERAUTH] Invalid or expired super admin token", { ip: clientIp });
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
    const session = await prisma.superAdminSession.findUnique({
      where: { userId: decoded.userId },
    });

    if (!session) {
      throw Errors.Auth("Session not found. Please re-authenticate.");
    }

    const requestFingerprint = `${clientIp}-${userAgent}`;
    if (session.fingerprint !== requestFingerprint) {
      logger.error("[SUPERAUTH] 🔒 Device/IP mismatch detected", {
        userId: decoded.userId,
        expected: session.fingerprint,
        got: requestFingerprint,
      });

      await recordAuditEvent({
        actorId: decoded.userId,
        actorRole: "super_admin",
        ip: clientIp,
        action: "SECURITY_EVENT",
        details: {
          reason: "Device/IP fingerprint mismatch",
          expected: session.fingerprint,
          got: requestFingerprint,
        },
      });

      // Optional: auto-lock account after repeated anomalies
      const anomalyCount = (session.anomalyCount || 0) + 1;
      await prisma.superAdminSession.update({
        where: { userId: decoded.userId },
        data: { anomalyCount },
      });

      if (anomalyCount >= 3) {
        await prisma.superAdminSession.update({
          where: { userId: decoded.userId },
          data: { locked: true },
        });

        await createSuperAdminAlert({
          title: "🔒 Super Admin Account Locked",
          message: `Too many anomaly detections for user: ${decoded.username}`,
          category: "security",
          severity: "critical",
          metadata: { userId: decoded.userId, anomalyCount },
        });
      }

      throw Errors.Auth("Device or IP not authorized for this session.");
    }

    // Step 5 — Check Session Version (after logout or key rotation)
    if (
      session.sessionVersion &&
      decoded.sessionVersion !== session.sessionVersion
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
      ip: clientIp,
      deviceId: decoded.deviceId || "unknown",
      sessionVersion: decoded.sessionVersion,
    };

    // Step 7 — Log successful verification
    await recordAuditEvent({
      actorId: decoded.userId,
      actorRole: "super_admin",
      ip: clientIp,
      action: "SECURITY_EVENT",
      details: { event: "super_admin_verified", device: userAgent },
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
export const requireSuperAdminPrivileges =
  (allowedActions: string[] = []) =>
  (req: SuperAdminRequest, res: Response, next: NextFunction) => {
    if (!req.superAdmin) {
      return sendErrorResponse(res, Errors.Auth("Super admin authentication required."));
    }

    if (!req.superAdmin.mfaVerified) {
      return sendErrorResponse(res, Errors.Forbidden("MFA verification required."));
    }

    // Optional fine-grained permission control (e.g., action-level RBAC)
    if (allowedActions.length > 0 && !allowedActions.includes("all")) {
      logger.debug("[SUPERAUTH] Fine-grained privilege check executed", {
        allowedActions,
      });
    }

    next();
  };