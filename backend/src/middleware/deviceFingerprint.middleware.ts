/**
 * src/middleware/deviceFingerprint.middleware.ts
 * ------------------------------------------------------------------------
 * 🧩 Device Fingerprint Middleware (Enterprise-Grade)
 *
 * Collects, normalizes, and hashes device identifiers for:
 *  - Security analysis & intrusion detection
 *  - Anti-abuse & trial-reuse prevention
 *  - MFA trust device validation
 *
 * ✅ Privacy-safe (hashes only)
 * ✅ Unified with /lib/deviceFingerprint.ts
 * ✅ Adds `req.fingerprint` for downstream services (auth, trialAudit, rateLimit)
 * ✅ Non-blocking (failsafe: always lets request proceed)
 * ------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import logger from "../logger";
import {
  generateDeviceFingerprint,
  normalizeFingerprintForDB,
  DeviceFingerprint,
} from "../lib/deviceFingerprint";

/**
 * Extended Request type that includes fingerprint info
 */
export interface FingerprintedRequest extends Request {
  fingerprint?: DeviceFingerprint;
  normalizedFingerprint?: ReturnType<typeof normalizeFingerprintForDB>;
}

/**
 * 🧠 Core Middleware
 * Collects fingerprint & attaches to request for downstream use.
 */
export const deviceFingerprint = (
  req: FingerprintedRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    // Generate fingerprint from current request
    const fingerprint = generateDeviceFingerprint(req);
    req.fingerprint = fingerprint;
    req.normalizedFingerprint = normalizeFingerprintForDB(fingerprint);

    logger.debug(
      `[DEVICE FINGERPRINT] Captured → IP=${fingerprint.components.ip} | DeviceHash=${fingerprint.deviceHash.slice(
        0,
        8
      )}...`
    );

    next();
  } catch (err: any) {
    logger.error(`[DEVICE FINGERPRINT] Failed to process: ${err.message}`);
    // Failsafe — do not block legitimate requests
    next();
  }
};

/**
 * 🧩 Optional Helper — Extract fingerprint metadata for logs/audit
 */
export const getFingerprintMetadata = (req: FingerprintedRequest) => {
  if (!req.fingerprint)
    return { ip: req.ip || "unknown", deviceHash: null, userAgent: req.headers["user-agent"] };

  return {
    ip: req.fingerprint.components.ip,
    deviceHash: req.fingerprint.deviceHash,
    userAgent: req.fingerprint.components.userAgent,
    platform: req.fingerprint.components.clientPlatform,
  };
};

/* ------------------------------------------------------------------------
   🧠 Future Enhancements
   - Integrate with IP reputation APIs (AbuseIPDB / Cloudflare)
   - Attach risk score to fingerprint (session anomaly detection)
   - Cache fingerprints temporarily in Redis for hot re-use
   - Use for MFA device trust management
------------------------------------------------------------------------ */