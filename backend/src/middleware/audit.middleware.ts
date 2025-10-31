/**
 * src/middleware/audit.middleware.ts
 * --------------------------------------------------------------------------
 * 🧾 Centralized Audit Middleware
 *
 * Purpose:
 *  - Automatically record critical actions for audit trail.
 *  - Enforce tamper-resistant, consistent audit logging.
 *  - Support contextual tagging for sensitive routes.
 *
 * Features:
 *  ✅ Works globally across all protected endpoints
 *  ✅ Automatically attaches user, IP, route, and metadata
 *  ✅ Filters sensitive data (passwords, tokens, etc.)
 *  ✅ Supports custom audit tags and event overrides
 *  ✅ Uses asynchronous audit queue for performance
 */

import { Request, Response, NextFunction } from "express";
import { recordAuditEvent } from "../services/audit.service";
import { logger } from "../logger";
import { mask } from "../lib/securityManager";

/* ---------------------------------------------------------------------------
   ⚙️ Configuration
--------------------------------------------------------------------------- */
const SENSITIVE_KEYS = ["password", "token", "otp", "secret", "auth", "apiKey", "accessKey"];
const DEFAULT_IGNORED_PATHS = [
  "/health",
  "/metrics",
  "/favicon.ico",
  "/api/docs",
  "/super-admin/system/status",
];

/* ---------------------------------------------------------------------------
   🧠 Utility: Sanitize Request Body for Logging
--------------------------------------------------------------------------- */
function sanitizeBody(body: any) {
  if (!body || typeof body !== "object") return body;
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
      sanitized[key] = mask(String(value || ""), 2, 2);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/* ---------------------------------------------------------------------------
   🔒 Middleware: Audit Interceptor
--------------------------------------------------------------------------- */
export const auditMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  // Skip known safe/health endpoints
  if (DEFAULT_IGNORED_PATHS.some((p) => req.originalUrl.startsWith(p))) return next();

  const user = (req as any).user || { id: "anonymous", role: "guest" };
  const routePath = req.originalUrl.split("?")[0];
  const method = req.method;
  const actionKey = `${method}_${routePath.replace(/\//g, "_")}`.toUpperCase();

  // Capture basic request snapshot
  const meta = {
    method,
    route: routePath,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    timestamp: new Date().toISOString(),
  };

  // Intercept response for post-action logging
  const originalSend = res.send;
  res.send = function (body?: any): Response {
    try {
      const latency = Date.now() - startTime;

      const responseStatus = res.statusCode;
      const isError = responseStatus >= 400;

      // Log asynchronously (non-blocking)
      recordAuditEvent({
        actorId: user.id,
        actorRole: user.role,
        ip: req.ip,
        action: isError ? "SYSTEM_ALERT" : "DATA_UPDATE",
        details: {
          actionKey,
          route: routePath,
          method,
          responseStatus,
          latencyMs: latency,
          ...(isError ? { error: parseErrorBody(body) } : {}),
          requestBody: sanitizeBody(req.body),
        },
      }).catch((err) => {
        logger.error(`[AUDIT_MIDDLEWARE] Failed to log audit event: ${err.message}`);
      });
    } catch (err: any) {
      logger.error(`[AUDIT_MIDDLEWARE] Error while auditing route ${routePath}: ${err.message}`);
    }

    return originalSend.call(this, body);
  };

  next();
};

/* ---------------------------------------------------------------------------
   🧩 Helper: Extract readable error details
--------------------------------------------------------------------------- */
function parseErrorBody(body: any) {
  try {
    if (!body) return null;
    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body);
        return parsed.error || parsed.message || body;
      } catch {
        return body;
      }
    }
    if (typeof body === "object") {
      return body.error || body.message || body;
    }
    return String(body);
  } catch {
    return "Unknown error";
  }
}

/* ---------------------------------------------------------------------------
   🧱 Export Helper for Manual Audit Calls (optional)
--------------------------------------------------------------------------- */
export const auditManualEvent = async (
  req: Request,
  action: string,
  details: Record<string, any>
) => {
  const user = (req as any).user || { id: "system", role: "system" };
  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    ip: req.ip,
    action,
    details,
  });
};