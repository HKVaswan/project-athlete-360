/**
 * Enterprise-grade rate limiter middleware
 *
 * - In-memory sliding window for single-instance deployments (safe fallback).
 * - Optional Redis backing (recommended for production with multiple app instances).
 * - Sends standard rate limit headers:
 *   - X-RateLimit-Limit
 *   - X-RateLimit-Remaining
 *   - X-RateLimit-Reset (unix epoch seconds)
 *
 * Usage:
 *   app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 100 }));
 *   app.use('/api/public', rateLimit({ windowMs: 60*1000, max: 20, keyGenerator: (req) => req.ip }));
 */

import { Request, Response, NextFunction } from "express";

type RateLimitOpts = {
  windowMs?: number; // window in milliseconds
  max?: number; // max requests per window
  message?: string | object;
  keyGenerator?: (req: Request) => string; // function to generate key (default: IP)
  skip?: (req: Request) => boolean; // optional skip function
  trustProxy?: boolean; // whether to use X-Forwarded-For
};

const DEFAULTS: Required<Pick<RateLimitOpts, "windowMs" | "max" | "message" | "keyGenerator" | "skip" | "trustProxy">> = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { message: "Too many requests, please try again later." },
  keyGenerator: (req: Request) => (req.ip || req.socket.remoteAddress || "unknown"),
  skip: () => false,
  trustProxy: true,
};

type WindowRecord = {
  // stores timestamps (ms) of requests in this window for sliding-window algorithm
  timestamps: number[];
};

const inMemoryStore = new Map<string, WindowRecord>();

/**
 * Optional Redis integration.
 * If ioredis is installed and REDIS_URL set, the middleware will automatically
 * attempt to use Redis. This is best for production horizontal scaling.
 *
 * The code attempts to import 'ioredis' dynamically — if not installed, it falls back gracefully.
 */
let redisClient: any = null;
const tryInitRedis = (() => {
  let attempted = false;
  return () => {
    if (attempted) return;
    attempted = true;
    const url = process.env.REDIS_URL;
    if (!url) return;
    try {
      // dynamic import so package is optional
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require("ioredis");
      redisClient = new IORedis(url, { maxRetriesPerRequest: null });
      redisClient.on("error", (err: any) => {
        // log but don't throw
        // eslint-disable-next-line no-console
        console.warn("[rateLimit] Redis error — falling back to in-memory limiter:", err?.message || err);
        redisClient = null;
      });
      // eslint-disable-next-line no-console
      console.info && console.info("[rateLimit] Connected to Redis for rate limiting.");
    } catch (err) {
      // ioredis not installed — that's fine; we just use in-memory
      // eslint-disable-next-line no-console
      console.info && console.info("[rateLimit] Redis not available; using in-memory rate limiter.");
      redisClient = null;
    }
  };
})();

/**
 * Helper: set standard rate-limit headers on response
 */
function setRateLimitHeaders(res: Response, max: number, remaining: number, resetTsSeconds: number) {
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("X-RateLimit-Reset", String(resetTsSeconds));
}

/**
 * Create rateLimit middleware
 */
export const rateLimit = (opts?: RateLimitOpts) => {
  const config = { ...DEFAULTS, ...(opts || {}) };

  // If trustProxy is enabled, override keyGenerator to use forwarded ip if provided
  const keyGen = (req: Request) => {
    if (config.trustProxy) {
      const forwarded = (req.headers["x-forwarded-for"] as string | undefined);
      if (forwarded) return forwarded.split(",")[0].trim();
    }
    return config.keyGenerator(req);
  };

  // Try initialize redis once (if available)
  tryInitRedis();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (config.skip && config.skip(req)) return next();

      const key = `rl:${keyGen(req)}`;

      const now = Date.now();
      const windowStart = now - config.windowMs;

      // If Redis is available, use it (Lua script like sliding-window)
      if (redisClient) {
        try {
          // We'll implement sliding window using sorted sets (zset)
          // - zadd with score = timestamp
          // - zremrangebyscore < windowStart
          // - zcard to count
          // - expire to set TTL for cleanup
          const zaddAsync = (memberTs: number) =>
            redisClient.zadd(key, memberTs, String(memberTs));
          const zremrangeAsync = () =>
            redisClient.zremrangebyscore(key, 0, windowStart);
          const zcardAsync = () => redisClient.zcard(key);
          const expireAsync = () =>
            redisClient.expire(key, Math.ceil(config.windowMs / 1000) + 5);

          await zremrangeAsync();
          await zaddAsync(now);
          await expireAsync();
          const count = await zcardAsync();

          const remaining = config.max - count;
          const resetTsSeconds = Math.floor((now + config.windowMs) / 1000);

          setRateLimitHeaders(res, config.max, remaining, resetTsSeconds);

          if (count > config.max) {
            res.status(429).json(typeof config.message === "string" ? { message: config.message } : config.message);
            return;
          }

          return next();
        } catch (err) {
          // If Redis fails unexpectedly, fallback to in-memory approach below
          // eslint-disable-next-line no-console
          console.warn("[rateLimit] Redis operation failed, falling back to in-memory limiter.", err?.message || err);
        }
      }

      // In-memory sliding window
      let record = inMemoryStore.get(key);
      if (!record) {
        record = { timestamps: [] };
        inMemoryStore.set(key, record);
      }

      // drop timestamps outside the window
      record.timestamps = record.timestamps.filter((t) => t > windowStart);

      record.timestamps.push(now);

      const count = record.timestamps.length;
      const remaining = config.max - count;
      const resetTsSeconds = Math.floor((windowStart + config.windowMs) / 1000);

      // set headers
      setRateLimitHeaders(res, config.max, remaining, resetTsSeconds);

      if (count > config.max) {
        res.status(429).json(typeof config.message === "string" ? { message: config.message } : config.message);
        return;
      }

      // occasional cleanup to prevent memory leak (only when map grows large)
      if (inMemoryStore.size > 5000) {
        // sweep lightly (non-blocking)
        setImmediate(() => {
          const cutoff = Date.now() - config.windowMs * 2;
          for (const [k, v] of inMemoryStore.entries()) {
            if (!v.timestamps.length || v.timestamps[v.timestamps.length - 1] < cutoff) {
              inMemoryStore.delete(k);
            }
          }
        });
      }

      return next();
    } catch (err) {
      // Do not crash the app for rate-limiter issues — allow request through
      // eslint-disable-next-line no-console
      console.error("[rateLimit] Unexpected error:", err);
      return next();
    }
  };
};

/**
 * Convenience pre-configured middlewares
 */
export const publicRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: opts?.windowMs ?? 15 * 60 * 1000, max: opts?.max ?? 100 });

export const strictRateLimit = (opts?: Partial<RateLimitOpts>) =>
  rateLimit({ ...opts, windowMs: opts?.windowMs ?? 60 * 1000, max: opts?.max ?? 20 });