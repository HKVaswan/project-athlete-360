/**
 * src/middleware/intrusionDetection.middleware.ts
 *
 * Enterprise-grade Intrusion & Abuse Detection middleware.
 *
 * Goals:
 *  - Detect repeated abusive behaviour (failed logins, repeated 4xx/5xx from same IP/user)
 *  - Progressive penalties: warnings -> temporary ban -> extended ban -> permanent ban (flag)
 *  - Uses Redis for accurate counters and TTLs. Falls back to in-memory store if Redis missing.
 *  - Emits audit log entries for important events.
 *  - Non-blocking & resilient (fails open if datastore unavailable, but logs warnings).
 *  - Configurable sensitive route list to focus protection on auth/ai endpoints.
 *
 * Usage:
 *  app.use(intrusionDetection({ ...options }));
 *
 * Notes:
 *  - This middleware observes responses (res.on('finish')) and increments counters
 *    for endpoints that returned suspicious status codes (401, 403, 429, 500).
 *  - It blocks requests early when IP/user is currently banned.
 *  - It is intentionally conservative — avoid false positives by tuning thresholds.
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import IORedis from "ioredis";
import { logger } from "../logger";
import { config } from "../config";
import { auditService } from "../services/audit.service"; // robust audit integration
import securityManager from "../lib/securityManager"; // masking/rate key helpers

// ---------- Configurable defaults (tune as needed in config or env) ----------
const DEFAULTS = {
  redisUrl: config.redisUrl || process.env.REDIS_URL || "",
  warnThreshold: Number(process.env.INTRUSION_WARN_THRESHOLD || 5), // attempts before warn
  tempBanThreshold: Number(process.env.INTRUSION_TEMP_BAN_THRESHOLD || 10), // attempts -> temp ban
  extendedBanThreshold: Number(process.env.INTRUSION_EXTENDED_BAN_THRESHOLD || 25), // attempts -> extended ban
  banDurationSeconds: Number(process.env.INTRUSION_BAN_SECONDS || 60 * 15), // 15 min
  extendedBanDurationSeconds: Number(process.env.INTRUSION_BAN_EXTENDED_SECONDS || 60 * 60 * 24), // 24 h
  permanentBanThreshold: Number(process.env.INTRUSION_PERM_BAN_THRESHOLD || 100), // mark permanent
  slidingWindowSeconds: Number(process.env.INTRUSION_WINDOW_SECONDS || 60 * 60), // 1 hour sliding window
  sensitivePaths: config.intrusionSensitivePaths || ["/api/auth", "/api/ai", "/api/login", "/api/register", "/api/reset", "/api/superadmin"], // prefix match
  whitelistIps: (config.intrusionWhitelistIps || []).map(String), // ips never blocked (e.g. internal)
  debug: process.env.INTRUSION_DEBUG === "true" || false,
};

// ---------- Redis client or in-memory fallback ----------
let redis: IORedis | null = null;
let inMemoryStore: Map<string, { count: number; firstSeen: number }> | null = null;

if (DEFAULTS.redisUrl) {
  try {
    redis = new IORedis(DEFAULTS.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    redis.on("error", (err) => logger.warn("[INTRUSION] Redis error", err));
    logger.info("[INTRUSION] Using Redis for intrusion tracking");
  } catch (err: any) {
    logger.warn("[INTRUSION] Failed to initialize Redis, falling back to memory store", err?.message || err);
    redis = null;
    inMemoryStore = new Map();
  }
} else {
  logger.warn("[INTRUSION] REDIS_URL not configured — using in-memory store (not suitable for multi-instance)");
  inMemoryStore = new Map();
}

// ---------- Helpers ----------
const ipKey = (ip: string) => `intrusion:ip:${ip}`;
const userKey = (userId: string) => `intrusion:user:${userId}`;
const banIpKey = (ip: string) => `intrusion:ban:ip:${ip}`;
const banUserKey = (userId: string) => `intrusion:ban:user:${userId}`;
const permFlagIpKey = (ip: string) => `intrusion:perm:ip:${ip}`;
const permFlagUserKey = (id: string) => `intrusion:perm:user:${id}`;

const nowSecs = () => Math.floor(Date.now() / 1000);

const isSensitivePath = (path: string) => {
  for (const p of DEFAULTS.sensitivePaths) {
    if (path.startsWith(p)) return true;
  }
  return false;
};

/**
 * Increment sliding-window counter for a key in Redis or in-memory store.
 * Returns total count within window after increment.
 */
async function incrSliding(key: string, windowSec = DEFAULTS.slidingWindowSeconds): Promise<number> {
  if (redis) {
    // Use Redis INCR + EXPIRE to implement sliding window approximation
    const count = await redis.incr(key);
    const ttl = await redis.ttl(key);
    if (ttl === -1) {
      await redis.expire(key, windowSec);
    }
    return count;
  } else {
    // In-memory fallback — coarse approximation
    if (!inMemoryStore) inMemoryStore = new Map();
    const entry = inMemoryStore.get(key);
    const now = nowSecs();
    if (!entry || now - entry.firstSeen > windowSec) {
      inMemoryStore.set(key, { count: 1, firstSeen: now });
      return 1;
    } else {
      entry.count += 1;
      inMemoryStore.set(key, entry);
      return entry.count;
    }
  }
}

/**
 * Set a temporary ban key with TTL
 */
async function setTempBan(key: string, durationSec: number) {
  if (redis) {
    await redis.set(key, "1", "EX", durationSec);
  } else {
    // in-memory: store as permanent flag with expiry stored in value map
    if (!inMemoryStore) inMemoryStore = new Map();
    inMemoryStore.set(key, { count: 1, firstSeen: nowSecs() + durationSec }); // firstSeen used as expiry marker here
  }
}

/**
 * Check if banned
 */
async function isBanned(key: string): Promise<boolean> {
  if (redis) {
    const v = await redis.get(key);
    return !!v;
  } else {
    if (!inMemoryStore) return false;
    const entry = inMemoryStore.get(key);
    if (!entry) return false;
    // if stored with expiry marker
    if (entry.firstSeen && entry.firstSeen > nowSecs()) return true;
    // otherwise treat as not banned
    return false;
  }
}

/**
 * Mark permanent flag (no TTL)
 */
async function setPermFlag(key: string) {
  if (redis) {
    await redis.set(key, "1"); // no expiry -> permanent marker
  } else {
    if (!inMemoryStore) inMemoryStore = new Map();
    inMemoryStore.set(key, { count: 999999, firstSeen: nowSecs() });
  }
}
async function isPermFlagged(key: string): Promise<boolean> {
  if (redis) {
    const v = await redis.get(key);
    return !!v;
  } else {
    if (!inMemoryStore) return false;
    const entry = inMemoryStore.get(key);
    return !!entry && entry.count >= 999999;
  }
}

/**
 * Report incident to audit service (non-blocking).
 */
async function reportAudit(actorId: string | null, actorRole: string | null, ip: string, action: string, details = {}) {
  try {
    await auditService.log({
      actorId: actorId ?? "unknown",
      actorRole: actorRole ?? "system",
      ip,
      action: action as any,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.warn("[INTRUSION] Failed to record audit", err?.message || err);
  }
}

/**
 * Core detector logic: inspect res.statusCode on finish and take actions.
 */
async function analyzeAndAct(opts: {
  ip: string;
  userId?: string | null;
  path: string;
  method: string;
  statusCode: number;
}) {
  const { ip, userId, path, method, statusCode } = opts;

  // Only consider suspicious status codes for sensitive endpoints or auth paths
  const suspiciousStatuses = [401, 403, 429, 500];
  if (!suspiciousStatuses.includes(statusCode) && !isSensitivePath(path)) {
    // Not suspicious
    if (DEFAULTS.debug) logger.debug(`[INTRUSION] Ignoring status ${statusCode} for ${path}`);
    return;
  }

  const ipK = ipKey(ip);
  const uidK = userId ? userKey(userId) : null;

  // Increment counters
  const ipCount = await incrSliding(ipK);
  const userCount = uidK ? await incrSliding(uidK) : 0;

  if (DEFAULTS.debug) {
    logger.debug(`[INTRUSION] Counters for ip=${ip} -> ${ipCount}, user=${userId} -> ${userCount}`);
  }

  // Check thresholds for IP
  if (ipCount >= DEFAULTS.permanentBanThreshold) {
    await setPermFlag(permFlagIpKey(ip));
    await reportAudit(null, "system", ip, "PERMANENT_BAN_IP", { ipCount, path, method, statusCode });
    logger.warn(`[INTRUSION] Permanent flag set for IP ${ip}`);
    return;
  }

  if (ipCount >= DEFAULTS.extendedBanThreshold) {
    // Extended ban
    await setTempBan(banIpKey(ip), DEFAULTS.extendedBanDurationSeconds);
    await reportAudit(null, "system", ip, "EXTENDED_BAN_IP", { ipCount, path, method, statusCode });
    logger.warn(`[INTRUSION] Extended ban applied to IP ${ip} for ${DEFAULTS.extendedBanDurationSeconds}s`);
    return;
  }

  if (ipCount >= DEFAULTS.tempBanThreshold) {
    // Temp ban
    await setTempBan(banIpKey(ip), DEFAULTS.banDurationSeconds);
    await reportAudit(null, "system", ip, "TEMP_BAN_IP", { ipCount, path, method, statusCode });
    logger.warn(`[INTRUSION] Temp ban applied to IP ${ip} for ${DEFAULTS.banDurationSeconds}s`);
    return;
  }

  if (ipCount >= DEFAULTS.warnThreshold) {
    await reportAudit(null, "system", ip, "WARN_IP", { ipCount, path, method, statusCode });
    logger.info(`[INTRUSION] Warning threshold reached for IP ${ip}`);
  }

  // Repeat same checks for user if available (more sensitive)
  if (userId) {
    if (userCount >= DEFAULTS.permanentBanThreshold) {
      await setPermFlag(permFlagUserKey(userId));
      await reportAudit(userId, "user", ip, "PERMANENT_BAN_USER", { userCount, path, method, statusCode });
      logger.warn(`[INTRUSION] Permanent flag set for user ${userId}`);
      return;
    }

    if (userCount >= DEFAULTS.extendedBanThreshold) {
      await setTempBan(banUserKey(userId), DEFAULTS.extendedBanDurationSeconds);
      await reportAudit(userId, "user", ip, "EXTENDED_BAN_USER", { userCount, path, method, statusCode });
      logger.warn(`[INTRUSION] Extended ban applied to user ${userId}`);
      return;
    }

    if (userCount >= DEFAULTS.tempBanThreshold) {
      await setTempBan(banUserKey(userId), DEFAULTS.banDurationSeconds);
      await reportAudit(userId, "user", ip, "TEMP_BAN_USER", { userCount, path, method, statusCode });
      logger.warn(`[INTRUSION] Temp ban applied to user ${userId}`);
      return;
    }

    if (userCount >= DEFAULTS.warnThreshold) {
      await reportAudit(userId, "user", ip, "WARN_USER", { userCount, path, method, statusCode });
      logger.info(`[INTRUSION] Warning threshold reached for user ${userId}`);
    }
  }
}

/**
 * Middleware factory
 */
export const intrusionDetection = (options?: Partial<typeof DEFAULTS>): RequestHandler => {
  const cfg = { ...DEFAULTS, ...(options || {}) };

  // copy chosen values into DEFAULTS for helper functions - keep simple for now
  Object.assign(DEFAULTS, cfg);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = (req.ip || req.socket.remoteAddress || "unknown") as string;

      // quick allowlist
      if (DEFAULTS.whitelistIps.includes(ip)) return next();

      // Check permanent flags / bans early
      const ipPerm = await isPermFlagged(permFlagIpKey(ip));
      const ipBanned = await isBanned(banIpKey(ip));

      // If user token attached (we may have req.user from auth middleware) check user bans too
      const userId = (req as any).user?.id as string | undefined;
      const userPerm = userId ? await isPermFlagged(permFlagUserKey(userId)) : false;
      const userBanned = userId ? await isBanned(banUserKey(userId)) : false;

      if (ipPerm || userPerm) {
        // permanent block
        logger.warn(`[INTRUSION] Permanent block - access denied ip=${ip} user=${userId || "anonymous"}`);
        await reportAudit(userId ?? null, userId ? "user" : "unknown", ip, "ACCESS_DENIED_PERMANENT", {
          ipPerm, userPerm,
          path: req.originalUrl,
        });
        return res.status(403).json({ success: false, message: "Access denied." });
      }

      if (ipBanned || userBanned) {
        // temporary ban
        logger.warn(`[INTRUSION] Temporary ban active - rejecting request ip=${ip} user=${userId || "anonymous"}`);
        await reportAudit(userId ?? null, userId ? "user" : "unknown", ip, "ACCESS_DENIED_TEMPORARY", {
          ipBanned,
          userBanned,
          path: req.originalUrl,
        });

        return res.status(429).json({
          success: false,
          message:
            "Too many suspicious requests from your IP or account. Try again later or contact support.",
        });
      }

      // Attach a finish listener to inspect response status after controller runs
      res.on("finish", () => {
        // Run asynchronously; do not block response
        (async () => {
          try {
            const statusCode = res.statusCode;
            // Only analyze sensitive paths or suspicious status codes to avoid noise
            await analyzeAndAct({
              ip,
              userId: userId ?? null,
              path: req.originalUrl,
              method: req.method,
              statusCode,
            });
          } catch (err: any) {
            logger.error("[INTRUSION] analyzeAndAct failed", err?.message || err);
          }
        })().catch((e) => logger.warn("[INTRUSION] async analysis error", e?.message || e));
      });

      next();
    } catch (err: any) {
      // Fail open: do not block legitimate traffic if intrusion middleware fails
      logger.error("[INTRUSION] middleware failure - failing open", { err: err?.message || err });
      next();
    }
  };
};

export default intrusionDetection;