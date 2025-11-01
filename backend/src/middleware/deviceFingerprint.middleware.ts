/**
 * src/middleware/deviceFingerprint.middleware.ts
 * ------------------------------------------------------------------------
 * 🧩 Device Fingerprint Middleware (Enterprise-Grade)
 *
 * Collects, normalizes, and hashes device identifiers for security analysis,
 * anti-abuse detection, and trial-reuse prevention.
 *
 * Features:
 *  - Privacy-safe (stores only SHA-256 hashes of identifiers)
 *  - Works for both web and API clients
 *  - Adds `req.fingerprint` for downstream services (auth, trial, security)
 *  - Compatible with IntrusionDetection & TrialAudit systems
 * ------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import logger from "../logger";

/* ------------------------------------------------------------------------
   🔒 Utility: Hash identifier securely (SHA-256)
------------------------------------------------------------------------ */
const hash = (input: string): string =>
  crypto.createHash("sha256").update(input.trim().toLowerCase()).digest("hex");

/* ------------------------------------------------------------------------
   🧠 Middleware Definition
------------------------------------------------------------------------ */
export interface FingerprintedRequest extends Request {
  fingerprint?: {
    hashedIp: string;
    hashedUA: string | null;
    hashedDevice: string | null;
    ip: string;
    userAgent?: string;
    rawDeviceId?: string | null;
  };
}

/**
 * Generates a robust fingerprint using:
 *  - IP address (always required)
 *  - User-Agent (browser/app info)
 *  - Optional `X-Device-ID` header for app/mobile identification
 */
export const deviceFingerprint = (
  req: FingerprintedRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const userAgent = req.headers["user-agent"] || "unknown";
    const rawDeviceId =
      (req.headers["x-device-id"] as string) ||
      (req.cookies?.deviceId as string) ||
      null;

    const hashedIp = hash(ip);
    const hashedUA = userAgent !== "unknown" ? hash(userAgent) : null;
    const hashedDevice = rawDeviceId ? hash(rawDeviceId) : null;

    req.fingerprint = {
      hashedIp,
      hashedUA,
      hashedDevice,
      ip,
      userAgent,
      rawDeviceId,
    };

    logger.debug(`[DEVICE FINGERPRINT] Collected for IP: ${ip}`);

    next();
  } catch (err: any) {
    logger.error(`[DEVICE FINGERPRINT] Error collecting fingerprint: ${err.message}`);
    // Don’t block the request — system can still proceed without fingerprint
    next();
  }
};

/* ------------------------------------------------------------------------
   🧩 Optional Helper: Attach fingerprint to logs / audit
------------------------------------------------------------------------ */
export const getFingerprintMetadata = (req: FingerprintedRequest) => {
  return req.fingerprint
    ? {
        ip: req.fingerprint.ip,
        hashedIp: req.fingerprint.hashedIp,
        hashedUA: req.fingerprint.hashedUA,
        hashedDevice: req.fingerprint.hashedDevice,
        userAgent: req.fingerprint.userAgent,
      }
    : { ip: req.ip || "unknown" };
};

/* ------------------------------------------------------------------------
   🧠 Future Enhancements
   - Integrate with IP reputation services (AbuseIPDB / Cloudflare Radar)
   - Add browser fingerprinting via client script (FPJS or custom)
   - Combine with session anomalies for risk scoring
   - Save fingerprints in Redis cache for real-time detection
------------------------------------------------------------------------ */