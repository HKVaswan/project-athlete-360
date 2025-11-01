// src/middleware/rateLimit.middleware.ts
/**
 * 🚦 Enterprise-Grade Rate Limiting Middleware (Final Hardened Version)
 * --------------------------------------------------------------------------
 * - Redis + in-memory fallback (horizontal scaling)
 * - Sliding window algorithm
 * - Dynamic per-role limits
 * - IP escalation & temporary block
 * - Integration with trialAuditService (for abuse tracking)
 * - Skips trusted system routes (super admin or internal worker)
 * --------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import { auditService } from "../services/audit.service";
import { trialAuditService } from "../services/trialAudit.service";
import { logger } from "../logger";

type RateLimitOpts = {
  windowMs?: number;
  max?: number;
  message?: string | object;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  trustProxy?: boolean;
};

const DEFAULTS: Required<
  Pick<RateLimitOpts, "windowMs" | "max" | "message" | "keyGenerator" | "skip" | "trustProxy">
> = {
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: "Too many requests, please try again later." },
  keyGenerator: (req: Request) => req.ip || req.socket.remoteAddress || "unknown",
  skip: () => false,
  trustProxy: true,
};

type WindowRecord = { timestamps: number[] };
const inMemoryStore = new Map<string, WindowRecord>();

// Optional Redis
let redisClient: any = null;
const tryInitRedis = (() => {
  let attempted = false;
  return () => {
    if (attempted) return;
    attempted = true;
    const url = process.env.REDIS_URL;
    if (!url) return;
    try {
      const IORedis = require("ioredis");
      redisClient = new IORedis(url, { maxRetriesPerRequest: null });
      redisClient.on("error", (err: any) => {
        logger.warn("[RateLimit] Redis error → fallback to memory:", err?.message);
        redisClient = null;
      });
      logger.info("[RateLimit] Connected to Redis.");
    } catch {
      logger.info("[RateLimit] Redis not available, using in-memory limiter.");
      redisClient = null;
    }
  };
})();

/* --------------------------------------------------------------------------
   🧮 Role-based Limits
--------------------------------------------------------------------------- */
const ROLE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  super_admin: { windowMs: 30_000, max: 9999 },
  admin: { windowMs: 60_000, max: 200 },
  coach: { windowMs: 60_000, max: 80 },
  athlete: { windowMs: 60_000, max: 60 },
  public: { windowMs: 60_000, max: 40 },
};

/* --------------------------------------------------------------------------
   🔐 Temporary IP Ban (Escalation)
--------------------------------------------------------------------------- */
async function isIPBlocked(ip: string): Promise<boolean> {
  if (!redisClient) return false;
  const blocked = await redisClient.get(`block:${ip}`);
  return !!blocked;
}

async function blockIP(ip: string, reason = "Excessive requests") {
  if (!redisClient) return;
  await redisClient.setex(`block:${ip}`, 600, reason); // 10 minutes block
}

/* --------------------------------------------------------------------------
   🧱 Middleware Core
--------------------------------------------------------------------------- */
export const rateLimit = (opts?: RateLimitOpts) => {
  const config = { ...DEFAULTS, ...(opts || {}) };
  const keyGen = (req: Request) => {
    if (config.trustProxy) {
      const forwarded = req.headers["x-forwarded-for"] as string | undefined;
      if (forwarded) return forwarded.split(",")[0].trim();
    }
    return config.keyGenerator(req);
  };

  tryInitRedis();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (config.skip(req)) return next();

      const user = (req as any).user;
      const role = user?.role?.toLowerCase?.() || "public";
      if (role === "super_admin") return next(); // exempt

      const limits = ROLE_LIMITS[role] || ROLE_LIMITS.public;
      const windowMs = limits.windowMs;
      const max = limits.max;
      const now = Date.now();
      const windowStart = now - windowMs;

      const ip = keyGen(req);
      if (await isIPBlocked(ip)) {
        res.status(429).json({ message: "Temporarily blocked due to repeated abuse." });
        return;
      }

      const key = `rl:${ip}:${role}:${req.baseUrl || req.path}`;

      // Redis mode
      if (redisClient) {
        try {
          await redisClient.zremrangebyscore(key, 0, windowStart);
          await redisClient.zadd(key, now, String(now));
          await redisClient.expire(key, Math.ceil(windowMs / 1000) + 5);
          const count = await redisClient.zcard(key);
          const remaining = max - count;
          const reset = Math.floor((now + windowMs) / 1000);

          setHeaders(res, max, remaining, reset);

          if (count > max) {
            await handleLimitExceeded(req, res, role, ip, key, max);
            return;
          }

          return next();
        } catch (err: any) {
          logger.warn(`[RateLimit] Redis failed → fallback: ${err.message}`);
        }
      }

      // Memory fallback
      let record = inMemoryStore.get(key);
      if (!record) record = { timestamps: [] };
      record.timestamps = record.timestamps.filter((t) => t > windowStart);
      record.timestamps.push(now);
      inMemoryStore.set(key, record);

      const count = record.timestamps.length;
      const remaining = max - count;
      const reset = Math.floor((now + windowMs) / 1000);

      setHeaders(res, max, remaining, reset);
      if (count > max) {
        await handleLimitExceeded(req, res, role, ip, key, max);
        return;
      }

      cleanupMemoryStore(windowMs);
      next();
    } catch (err: any) {
      logger.error(`[RateLimit] Unexpected error: ${err.message}`);
      next();
    }
  };
};

/* --------------------------------------------------------------------------
   ⚠️ Handle Exceeded Limit
--------------------------------------------------------------------------- */
async function handleLimitExceeded(
  req: Request,
  res: Response,
  role: string,
  ip: string,
  key: string,
  max: number
) {
  const user = (req as any).user;
  logger.warn(`[RateLimit] 🚫 ${role} exceeded limit from IP=${ip} key=${key}`);

  await auditService.log({
    actorId: user?.id || "anonymous",
    actorRole: role,
    ip,
    action: "RATE_LIMIT_EXCEEDED",
    details: { route: req.originalUrl, limit: max },
  });

  // Log abuse attempts for trial or public users
  if (role === "public" || role === "athlete") {
    await trialAuditService.recordAbuseAttempt({
      ip,
      endpoint: req.originalUrl,
      type: "rate_limit",
      timestamp: new Date(),
    });
  }

  // Temporary block escalation
  if (redisClient) {
    const keyAbuse = `abuseCount:${ip}`;
    const count = await redisClient.incr(keyAbuse);
    await redisClient.expire(keyAbuse, 600); // 10 min window
    if (count >= 3) {
      await blockIP(ip, "Repeated rate-limit hits");
      logger.warn(`[RateLimit] 🔒 IP temporarily blocked: ${ip}`);
    }
  }

  res.status(429).json({ message: "Too many requests. Please try again later." });
}

/* --------------------------------------------------------------------------
   🧰 Helpers
--------------------------------------------------------------------------- */
function setHeaders(res: Response, max: number, remaining: number, reset: number) {
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("X-RateLimit-Reset", String(reset));
}

function cleanupMemoryStore(windowMs: number) {
  if (inMemoryStore.size > 5000) {
    const cutoff = Date.now() - windowMs * 2;
    setImmediate(() => {
      for (const [k, v] of inMemoryStore.entries()) {
        if (!v.timestamps.length || v.timestamps[v.timestamps.length - 1] < cutoff)
          inMemoryStore.delete(k);
      }
    });
  }
}

/* --------------------------------------------------------------------------
   🚀 Preconfigured Variants
--------------------------------------------------------------------------- */
export const publicRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: 15 * 60 * 1000, max: 80 });

export const strictRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: 60 * 1000, max: 20 });

export const adminRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: 30 * 1000, max: 200 });

export const superAdminRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: 30 * 1000, max: 300 });