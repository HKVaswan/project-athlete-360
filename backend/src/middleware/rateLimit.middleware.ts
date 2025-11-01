/**
 * src/middleware/rateLimit.middleware.ts
 * --------------------------------------------------------------------------
 * 🚦 Enterprise-Grade Rate Limiting Middleware (Updated)
 *
 * Features:
 * - Redis + in-memory fallback (for horizontal + single instance scaling)
 * - Sliding window algorithm
 * - Per-role dynamic limits (SuperAdmin, InstitutionAdmin, Coach, Athlete, Public)
 * - Emits rate limit headers for client transparency
 * - Logs and audits repeated offenders (via auditService)
 * - Designed to integrate with intrusion detection middleware
 * --------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import { auditService } from "../services/audit.service";
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
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: { message: "Too many requests, please try again later." },
  keyGenerator: (req: Request) => req.ip || req.socket.remoteAddress || "unknown",
  skip: () => false,
  trustProxy: true,
};

type WindowRecord = { timestamps: number[] };

const inMemoryStore = new Map<string, WindowRecord>();

// Optional Redis setup
let redisClient: any = null;
const tryInitRedis = (() => {
  let attempted = false;
  return () => {
    if (attempted) return;
    attempted = true;
    const url = process.env.REDIS_URL;
    if (!url) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require("ioredis");
      redisClient = new IORedis(url, { maxRetriesPerRequest: null });
      redisClient.on("error", (err: any) => {
        console.warn("[rateLimit] Redis error, falling back to in-memory:", err?.message);
        redisClient = null;
      });
      console.info("[rateLimit] Connected to Redis for rate limiting.");
    } catch {
      console.info("[rateLimit] Redis not available; using in-memory limiter.");
      redisClient = null;
    }
  };
})();

/* --------------------------------------------------------------------------
   🧮 Role-based Limits
   - These define different windows and max requests per role for security.
--------------------------------------------------------------------------- */
const ROLE_LIMITS: Record<
  string,
  { windowMs: number; max: number; message?: string }
> = {
  superadmin: { windowMs: 30_000, max: 200, message: "SuperAdmin rate limit hit." },
  institution_admin: { windowMs: 60_000, max: 100 },
  coach: { windowMs: 60_000, max: 80 },
  athlete: { windowMs: 60_000, max: 60 },
  public: { windowMs: 60_000, max: 40 },
};

/* --------------------------------------------------------------------------
   🧰 Helper: Headers + Cleanup
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
        if (!v.timestamps.length || v.timestamps[v.timestamps.length - 1] < cutoff) {
          inMemoryStore.delete(k);
        }
      }
    });
  }
}

/* --------------------------------------------------------------------------
   🧱 Core Middleware
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
      const limits = ROLE_LIMITS[role] || ROLE_LIMITS["public"];

      const windowMs = limits.windowMs || config.windowMs;
      const max = limits.max || config.max;
      const message = limits.message || config.message;

      const now = Date.now();
      const windowStart = now - windowMs;

      const key = `rl:${keyGen(req)}:${role}:${req.baseUrl || req.path}`;

      // Redis mode (preferred)
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
            await handleLimitExceeded(req, res, role, key, message, max);
            return;
          }
          return next();
        } catch (err: any) {
          logger.warn(`[RateLimit] Redis failed → fallback to memory: ${err.message}`);
        }
      }

      // In-memory fallback
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
        await handleLimitExceeded(req, res, role, key, message, max);
        return;
      }

      cleanupMemoryStore(windowMs);
      next();
    } catch (err) {
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
  key: string,
  message: string | object,
  max: number
) {
  const user = (req as any).user;
  const ip = req.ip || req.headers["x-forwarded-for"];

  logger.warn(`[RateLimit] 🚫 ${role} exceeded limit → key=${key}`);

  // Log to audit system (superadmins can review this)
  await auditService.log({
    actorId: user?.id || "anonymous",
    actorRole: role,
    ip: String(ip),
    action: "RATE_LIMIT_EXCEEDED",
    details: {
      route: req.originalUrl,
      limit: max,
      key,
    },
  });

  res.status(429).json(
    typeof message === "string" ? { message } : message || {
      message: "Too many requests. Please try again later.",
    }
  );
}

/* --------------------------------------------------------------------------
   🚀 Preconfigured Variants
--------------------------------------------------------------------------- */
export const publicRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: opts?.windowMs ?? 15 * 60 * 1000, max: opts?.max ?? 80 });

export const strictRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: opts?.windowMs ?? 60 * 1000, max: opts?.max ?? 20 });

export const adminRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: opts?.windowMs ?? 30 * 1000, max: opts?.max ?? 200 });

export const superAdminRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: opts?.windowMs ?? 30 * 1000, max: opts?.max ?? 300 });