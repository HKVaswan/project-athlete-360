/**
 * src/middleware/requireSuperAdmin.middleware.ts
 * --------------------------------------------------------------------------
 * 🛡️  Enterprise Middleware — Require Super Admin Privileges
 *
 * Purpose:
 *   - Centralized enforcement of super_admin-only access.
 *   - Layered security checks beyond authentication (MFA, device, IP, etc.)
 *   - Fine-grained privilege validation (actions, scopes, etc.)
 *   - Full audit logging for every attempt (success/failure).
 *
 * Features:
 *  ✅ Enforces `role === "super_admin"`
 *  ✅ Optional action-based permission enforcement
 *  ✅ MFA & session verification
 *  ✅ Device/IP anomaly detection
 *  ✅ Full audit trail + security alert hooks
 * --------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import { Errors, sendErrorResponse } from "../utils/errors";
import { logger } from "../logger";
import { recordAuditEvent } from "../services/audit.service";
import { createSuperAdminAlert } from "../services/superAdminAlerts.service";
import { prisma } from "../prismaClient";

/* --------------------------------------------------------------------------
   🧩 Type Augmentation
-------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   🧱 Core Middleware
-------------------------------------------------------------------------- */
export function requireSuperAdmin(allowedActions: string[] = []) {
  return async (req: SuperAdminRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.superAdmin;

      // Step 1️⃣ — Must be authenticated as super admin
      if (!user || user.role !== "super_admin") {
        logger.warn("[ACCESS] Unauthorized attempt to access super_admin route", {
          ip: req.ip,
          path: req.originalUrl,
        });

        await recordAuditEvent({
          actorId: user?.id || "unknown",
          actorRole: "unknown",
          ip: req.ip,
          action: "SECURITY_EVENT",
          details: { reason: "unauthorized_super_admin_access", route: req.originalUrl },
        });

        throw Errors.Forbidden("Super admin privileges required.");
      }

      // Step 2️⃣ — Enforce MFA validation
      if (!user.mfaVerified) {
        logger.warn("[ACCESS] Super admin MFA check failed", { userId: user.id });
        throw Errors.Forbidden("Multi-factor authentication required.");
      }

      // Step 3️⃣ — Optional fine-grained permission check
      if (allowedActions.length > 0 && !allowedActions.includes("all")) {
        const rolePerms = await prisma.superAdminPermissions.findUnique({
          where: { userId: user.id },
        });

        const granted = rolePerms?.actions || [];
        const unauthorized = allowedActions.some((action) => !granted.includes(action));

        if (unauthorized) {
          logger.error("[ACCESS] Action-level denial for super_admin", {
            userId: user.id,
            required: allowedActions,
            granted,
          });

          await recordAuditEvent({
            actorId: user.id,
            actorRole: "super_admin",
            ip: req.ip,
            action: "SECURITY_EVENT",
            details: {
              reason: "action_denied",
              requiredActions: allowedActions,
              granted,
            },
          });

          await createSuperAdminAlert({
            title: "⚠️ Unauthorized Super Admin Action Attempt",
            message: `Super admin ${user.username} attempted restricted action on ${req.originalUrl}`,
            severity: "high",
            category: "security",
            metadata: { requiredActions: allowedActions },
          });

          throw Errors.Forbidden("You are not authorized for this action.");
        }
      }

      // Step 4️⃣ — Check for session anomaly
      const session = await prisma.superAdminSession.findUnique({
        where: { userId: user.id },
      });
      const fingerprint = `${req.ip}-${req.headers["user-agent"]}`;

      if (session && session.fingerprint !== fingerprint) {
        logger.error("[ACCESS] Device/IP fingerprint mismatch detected", {
          userId: user.id,
          expected: session.fingerprint,
          got: fingerprint,
        });

        await recordAuditEvent({
          actorId: user.id,
          actorRole: "super_admin",
          ip: req.ip,
          action: "SECURITY_EVENT",
          details: {
            event: "fingerprint_mismatch",
            expected: session.fingerprint,
            got: fingerprint,
          },
        });

        await createSuperAdminAlert({
          title: "🚨 Device/IP Mismatch Alert",
          message: `Fingerprint mismatch detected for ${user.username}`,
          severity: "critical",
          category: "security",
          metadata: { expected: session.fingerprint, got: fingerprint },
        });

        throw Errors.Auth("Device or IP not authorized for this session.");
      }

      // Step 5️⃣ — Attach request metadata and proceed
      req.superAdmin = {
        ...user,
        ip: req.ip,
        deviceId: user.deviceId || "unknown",
      };

      logger.debug(`[ACCESS] ✅ Super admin verified for ${req.originalUrl}`);

      await recordAuditEvent({
        actorId: user.id,
        actorRole: "super_admin",
        ip: req.ip,
        action: "SYSTEM_ALERT",
        details: {
          event: "super_admin_access_granted",
          route: req.originalUrl,
          method: req.method,
        },
      });

      next();
    } catch (err: any) {
      logger.error("[ACCESS] ❌ SuperAdmin enforcement failed", { message: err.message });
      sendErrorResponse(res, err);
    }
  };
}

/* --------------------------------------------------------------------------
   🪄 Optional Helper Middleware for Read-Only Routes
-------------------------------------------------------------------------- */
/**
 * A lightweight variant for read-only routes (e.g., audit viewing)
 * that only verifies role and MFA without action enforcement.
 */
export const requireSuperAdminReadOnly = requireSuperAdmin([]);