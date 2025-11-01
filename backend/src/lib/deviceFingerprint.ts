/**
 * src/lib/deviceFingerprint.ts
 * -------------------------------------------------------------------------
 * 🔍 Device Fingerprint Generator (Enterprise Version)
 *
 * Used by:
 *  - trialAudit.service.ts
 *  - auth.middleware.ts
 *  - rateLimit.middleware.ts
 *  - MFA & security subsystems
 *
 * Generates a stable, privacy-safe device fingerprint based on:
 *  - IP address
 *  - User-Agent
 *  - Accept-Language
 *  - Optional custom headers (device-id, x-client-platform)
 * -------------------------------------------------------------------------
 */

import crypto from "crypto";
import { Request } from "express";
import logger from "../logger";

export interface DeviceFingerprint {
  deviceHash: string;
  components: {
    ip?: string;
    userAgent?: string;
    acceptLang?: string;
    deviceIdHeader?: string;
    clientPlatform?: string;
  };
}

/* ------------------------------------------------------------------------
   🧠 Utility: Hash any string to sha256 hex
------------------------------------------------------------------------ */
const hash = (input: string) =>
  crypto.createHash("sha256").update(input).digest("hex");

/* ------------------------------------------------------------------------
   🎯 Generate Fingerprint from Express Request
------------------------------------------------------------------------ */
export const generateDeviceFingerprint = (req: Request): DeviceFingerprint => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      "unknown";

    const userAgent = req.headers["user-agent"] as string | undefined;
    const acceptLang = req.headers["accept-language"] as string | undefined;
    const deviceIdHeader = req.headers["x-device-id"] as string | undefined;
    const clientPlatform = req.headers["x-client-platform"] as string | undefined; // "web" | "android" | "ios" | etc.

    // Combine all relevant fields into a unique hash
    const rawFingerprint = `${ip}|${userAgent}|${acceptLang}|${deviceIdHeader}|${clientPlatform}`;
    const deviceHash = hash(rawFingerprint);

    return {
      deviceHash,
      components: {
        ip,
        userAgent,
        acceptLang,
        deviceIdHeader,
        clientPlatform,
      },
    };
  } catch (err: any) {
    logger.error(`[DEVICE FINGERPRINT] Failed to generate: ${err.message}`);
    return {
      deviceHash: hash("fallback-unknown"),
      components: {},
    };
  }
};

/* ------------------------------------------------------------------------
   🧩 Compare Fingerprints (for MFA or session continuity checks)
------------------------------------------------------------------------ */
export const compareFingerprints = (
  f1?: DeviceFingerprint,
  f2?: DeviceFingerprint
): boolean => {
  if (!f1 || !f2) return false;
  return f1.deviceHash === f2.deviceHash;
};

/* ------------------------------------------------------------------------
   ⚙️ Normalize Fingerprint (used before DB storage)
------------------------------------------------------------------------ */
export const normalizeFingerprintForDB = (fp: DeviceFingerprint) => ({
  hashedDevice: fp.deviceHash,
  hashedIp: fp.components.ip ? hash(fp.components.ip) : null,
  hashedUA: fp.components.userAgent ? hash(fp.components.userAgent) : null,
  platform: fp.components.clientPlatform || null,
});

/* ------------------------------------------------------------------------
   🔐 Use in request middleware (optional helper)
------------------------------------------------------------------------ */
export const attachFingerprintToRequest = (req: Request) => {
  const fp = generateDeviceFingerprint(req);
  (req as any).fingerprint = fp;
  return fp;
};