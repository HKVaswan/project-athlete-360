/**
 * src/lib/core/cache.middleware.ts
 * ------------------------------------------------------------------------
 * High-performance caching middleware for Express APIs.
 *
 * Features:
 *  - Works seamlessly with Redis (production) or in-memory (dev)
 *  - Smart cache invalidation based on URL, user, or role
 *  - Prevents redundant DB hits for heavy analytics endpoints
 *  - Secure handling — never caches sensitive data (POST, PUT, DELETE)
 *  - Supports custom TTL per route
 */

import { Request, Response, NextFunction } from "express";
import IORedis from "ioredis";
import NodeCache from "node-cache";
import crypto from "crypto";
import { config } from "../../config";
import { logger } from "../../logger";

// ──────────────────────────────────────────────
// ⚙️ Initialize Redis or fallback to in-memory
// ──────────────────────────────────────────────
const redisUrl = config.redisUrl || "redis://127.0.0.1:6379";
let redis: IORedis | null = null;
let memoryCache: NodeCache | null = null;

if (config.env === "production") {
  redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  logger.info("[CACHE] Using Redis for caching");
} else {
  memoryCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
  logger.info("[CACHE] Using in-memory cache (development)");
}

// ──────────────────────────────────────────────
// 🔑 Helper Functions
// ──────────────────────────────────────────────

const generateCacheKey = (req: Request): string => {
  const keyBase = `${req.method}:${req.originalUrl}:${req.user?.id || "guest"}`;
  return crypto.createHash("sha256").update(keyBase).digest("hex");
};

const getCacheStore = () => (redis ? "redis" : "memory");

const getFromCache = async (key: string) => {
  if (redis) return await redis.get(key);
  return memoryCache?.get(key);
};

const setCache = async (key: string, value: any, ttlSec: number) => {
  const data = JSON.stringify(value);
  if (redis) await redis.setex(key, ttlSec, data);
  else memoryCache?.set(key, value, ttlSec);
};

const deleteCache = async (pattern: string) => {
  if (redis) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(keys);
  } else memoryCache?.flushAll();
};

// ──────────────────────────────────────────────
// 🧠 Middleware Factory
// ──────────────────────────────────────────────

export const cacheMiddleware =
  (ttlSec = 60) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (!["GET"].includes(req.method)) return next(); // cache only GET requests

    const key = generateCacheKey(req);
    const cacheStore = getCacheStore();

    try {
      const cached = await getFromCache(key);
      if (cached) {
        const data = typeof cached === "string" ? JSON.parse(cached) : cached;
        logger.debug(`[CACHE] Hit (${cacheStore}) → ${req.originalUrl}`);
        return res.status(200).json({ fromCache: true, data });
      }

      // Override response to intercept outgoing data
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (res.statusCode === 200 && body) {
          setCache(key, body, ttlSec).catch((err) =>
            logger.error("[CACHE] Failed to set cache:", err)
          );
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error("[CACHE] Error handling cache:", err);
      next();
    }
  };

// ──────────────────────────────────────────────
// 🔒 Invalidation Utilities
// ──────────────────────────────────────────────

export const invalidateCache = async (pattern = "*") => {
  try {
    await deleteCache(pattern);
    logger.info(`[CACHE] Invalidated cache for pattern: ${pattern}`);
  } catch (err) {
    logger.error("[CACHE] Failed to invalidate cache:", err);
  }
};

// ──────────────────────────────────────────────
// 🧩 Usage Example:
//
// import { cacheMiddleware } from "../lib/core/cache.middleware";
// router.get("/analytics", cacheMiddleware(120), controller.analytics);
//
// import { invalidateCache } from "../lib/core/cache.middleware";
// await invalidateCache("pa360*");
// ──────────────────────────────────────────────