/**
 * src/lib/core/cacheManager.ts
 * ------------------------------------------------------------------------
 * Enterprise-grade cache manager.
 *
 * Features:
 *  - Prefer Redis (ioredis) with automatic fallback to in-memory cache (node-cache)
 *  - Namespacing, TTL, and safe JSON serialization
 *  - getOrSet helper (atomic-ish semantics using a short lock)
 *  - Simple distributed-lock using Redis SET NX + expire (best-effort)
 *  - Metrics-friendly (emit events) and graceful shutdown
 *
 * Usage:
 *  import cache from "../lib/core/cacheManager";
 *  await cache.set("users:123", userObj, { ttlSec: 3600 });
 *  const user = await cache.get("users:123");
 *  const value = await cache.getOrSet("k", async () => compute(), { ttlSec: 60 });
 */

import IORedis from "ioredis";
import NodeCache from "node-cache";
import EventEmitter from "events";
import { config } from "../../config";
import logger from "../../logger";

type CacheValue = any;

const DEFAULT_TTL = 60 * 60; // 1 hour in seconds
const LOCK_TTL = 5; // seconds for short locks

export interface GetOrSetOptions {
  ttlSec?: number;
  forceFresh?: boolean; // bypass cache and recompute
  lockKeySuffix?: string; // custom lock suffix
  lockWaitMs?: number; // wait time to poll for lock
}

class CacheManager extends EventEmitter {
  public redis?: IORedis.Redis;
  private fallback: NodeCache;
  private ready: boolean = false;
  private prefix: string;

  constructor(prefix = "pa360") {
    super();
    this.prefix = prefix;
    this.fallback = new NodeCache({ stdTTL: DEFAULT_TTL, checkperiod: 120 });
    this.initRedis();
  }

  private initRedis() {
    const redisUrl = config.redisUrl;
    if (!redisUrl) {
      logger.info("[CACHE] No REDIS configured — using in-memory fallback only.");
      this.ready = true;
      return;
    }

    try {
      this.redis = new IORedis(redisUrl, {
        // tuned options for production
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.redis.on("connect", () => logger.info("[CACHE] Redis connecting..."));
      this.redis.on("ready", () => {
        logger.info("[CACHE] Redis ready.");
        this.ready = true;
        this.emit("ready");
      });
      this.redis.on("error", (err) => {
        logger.error("[CACHE] Redis error: " + (err?.message || err));
        // don't crash — keep fallback
      });
      this.redis.connect().catch((err) => {
        logger.error("[CACHE] Redis connection failed: " + (err?.message || err));
      });
    } catch (err) {
      logger.error("[CACHE] Redis init failed: " + (err as any)?.message || err);
      this.ready = true;
    }
  }

  private key(k: string) {
    return `${this.prefix}:${k}`;
  }

  private async redisSet(key: string, value: CacheValue, ttlSec?: number) {
    if (!this.redis) throw new Error("Redis not available");
    const v = typeof value === "string" ? value : JSON.stringify(value);
    if (ttlSec && ttlSec > 0) {
      await this.redis.set(key, v, "EX", ttlSec);
    } else {
      await this.redis.set(key, v);
    }
  }

  private async redisGet(key: string): Promise<CacheValue | null> {
    if (!this.redis) throw new Error("Redis not available");
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /** Set key with TTL (seconds). */
  public async set(key: string, value: CacheValue, opts?: { ttlSec?: number }) {
    const k = this.key(key);
    const ttl = typeof opts?.ttlSec === "number" ? opts.ttlSec : DEFAULT_TTL;

    if (this.redis) {
      try {
        await this.redisSet(k, value, ttl);
        this.emit("set", key);
        return true;
      } catch (err) {
        logger.warn("[CACHE] redis.set failed, falling back to memory: " + (err as any)?.message);
      }
    }

    // fallback
    this.fallback.set(k, value, ttl);
    this.emit("set", key);
    return true;
  }

  /** Get key or null */
  public async get<T = any>(key: string): Promise<T | null> {
    const k = this.key(key);
    if (this.redis) {
      try {
        const v = await this.redisGet(k);
        this.emit("hitOrMiss", key, v !== null);
        return v as T | null;
      } catch (err) {
        logger.warn("[CACHE] redis.get failed, using fallback: " + (err as any)?.message);
      }
    }

    const mem = this.fallback.get<T>(k);
    this.emit("hitOrMiss", key, mem !== undefined && mem !== null);
    return mem ?? null;
  }

  /** Delete a key */
  public async del(key: string) {
    const k = this.key(key);
    if (this.redis) {
      try {
        await this.redis.del(k);
        this.emit("del", key);
        return;
      } catch (err) {
        logger.warn("[CACHE] redis.del failed: " + (err as any)?.message);
      }
    }
    this.fallback.del(k);
    this.emit("del", key);
  }

  /** Clear entire cache (use carefully) */
  public async flushAll() {
    if (this.redis) {
      try {
        await this.redis.flushdb();
        this.emit("flush");
        return;
      } catch (err) {
        logger.warn("[CACHE] redis.flushdb failed: " + (err as any)?.message);
      }
    }
    this.fallback.flushAll();
    this.emit("flush");
  }

  /**
   * Simple Redis based SET NX lock (best-effort). Returns true if lock acquired.
   * NOTE: this is not a fully featured Redlock implementation — fine for short critical sections.
   */
  public async acquireLock(lockName: string, ttlSec = LOCK_TTL) {
    if (!this.redis) return false;
    const lockKey = this.key(`lock:${lockName}`);
    try {
      const res = await this.redis.set(lockKey, "1", "NX", "EX", ttlSec);
      return res === "OK";
    } catch (err) {
      logger.warn("[CACHE] acquireLock failed: " + (err as any)?.message);
      return false;
    }
  }

  public async releaseLock(lockName: string) {
    if (!this.redis) return;
    const lockKey = this.key(`lock:${lockName}`);
    try {
      await this.redis.del(lockKey);
    } catch (err) {
      logger.warn("[CACHE] releaseLock failed: " + (err as any)?.message);
    }
  }

  /**
   * getOrSet:
   * - If present and forceFresh is false => return cached.
   * - Else attempt to acquire short lock, compute the value and set it.
   * - If lock cannot be acquired, poll briefly until value available or timeout.
   */
  public async getOrSet<T = any>(
    key: string,
    computeFn: () => Promise<T>,
    options: GetOrSetOptions = {}
  ): Promise<T> {
    const { ttlSec = DEFAULT_TTL, forceFresh = false, lockKeySuffix = "gorset", lockWaitMs = 250 } = options;
    const k = this.key(key);

    if (!forceFresh) {
      const cached = await this.get<T>(key);
      if (cached !== null && cached !== undefined) return cached;
    }

    const lockName = `${key}:${lockKeySuffix}`;
    const lockAcquired = await this.acquireLock(lockName, LOCK_TTL);

    if (lockAcquired) {
      try {
        // compute and set
        const value = await computeFn();
        try {
          await this.set(key, value, { ttlSec });
        } catch (err) {
          logger.warn("[CACHE] set failed after compute: " + (err as any)?.message);
        }
        return value;
      } finally {
        await this.releaseLock(lockName);
      }
    }

    // If lock not acquired, poll until value appears or timeout
    const timeoutMs = 5000; // wait up to 5s for another worker to compute
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const cached = await this.get<T>(key);
      if (cached !== null && cached !== undefined) return cached;
      await new Promise((r) => setTimeout(r, lockWaitMs));
    }

    // as fallback compute without lock (last resort)
    logger.warn(`[CACHE] Lock wait timeout for key=${key}. Computing without lock as fallback.`);
    const value = await computeFn();
    try {
      await this.set(key, value, { ttlSec });
    } catch (err) {
      logger.warn("[CACHE] set failed after fallback compute: " + (err as any)?.message);
    }
    return value;
  }

  /** Graceful shutdown */
  public async shutdown() {
    try {
      if (this.redis) {
        await this.redis.quit();
      }
      logger.info("[CACHE] Shutdown complete.");
    } catch (err) {
      logger.warn("[CACHE] Shutdown error: " + (err as any)?.message);
    }
  }
}

// singleton
const cache = new CacheManager(config.cachePrefix || "pa360");

export default cache;