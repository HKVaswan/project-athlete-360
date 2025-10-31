import Redis from "ioredis";
import NodeCache from "node-cache";
import { config } from "../config";
import { logger } from "../logger";

/**
 * Enterprise-Grade Cache System
 * --------------------------------------------------------
 *  - Primary: Redis (scalable distributed cache)
 *  - Secondary: NodeCache (in-memory fallback)
 *  - Supports:
 *      - TTL (time-to-live)
 *      - Namespaces
 *      - Graceful fallback & reconnection
 *      - Safe JSON serialization
 *  - Designed for global scale + fault tolerance
 */

class CacheManager {
  private redis: Redis | null;
  private memoryCache: NodeCache;
  private redisConnected = false;

  constructor() {
    this.redis = null;
    this.memoryCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
    this.initRedis();
  }

  private initRedis() {
    try {
      this.redis = new Redis(config.redisUrl || "redis://127.0.0.1:6379", {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        reconnectOnError: () => true,
      });

      this.redis.on("connect", () => {
        this.redisConnected = true;
        logger.info("🧠 Redis cache connected.");
      });

      this.redis.on("error", (err) => {
        this.redisConnected = false;
        logger.warn(`⚠️ Redis connection error: ${err.message}`);
      });

      this.redis.on("close", () => {
        this.redisConnected = false;
        logger.warn("⚠️ Redis connection closed.");
      });
    } catch (err: any) {
      logger.error("❌ Failed to initialize Redis:", err.message);
      this.redis = null;
      this.redisConnected = false;
    }
  }

  /**
   * Build a namespaced cache key
   */
  private buildKey(namespace: string, key: string) {
    return `${namespace}:${key}`;
  }

  /**
   * Save value to cache
   */
  async set(namespace: string, key: string, value: any, ttlSeconds = 600): Promise<void> {
    const cacheKey = this.buildKey(namespace, key);
    const serialized = JSON.stringify(value);

    if (this.redisConnected && this.redis) {
      try {
        await this.redis.set(cacheKey, serialized, "EX", ttlSeconds);
        return;
      } catch (err: any) {
        logger.warn(`[CACHE] Redis set failed, falling back: ${err.message}`);
      }
    }

    // fallback to in-memory
    this.memoryCache.set(cacheKey, value, ttlSeconds);
  }

  /**
   * Retrieve value from cache
   */
  async get<T>(namespace: string, key: string): Promise<T | null> {
    const cacheKey = this.buildKey(namespace, key);

    if (this.redisConnected && this.redis) {
      try {
        const data = await this.redis.get(cacheKey);
        if (data) return JSON.parse(data);
      } catch (err: any) {
        logger.warn(`[CACHE] Redis get failed: ${err.message}`);
      }
    }

    // fallback
    const memoryValue = this.memoryCache.get<T>(cacheKey);
    return memoryValue || null;
  }

  /**
   * Delete cache entry
   */
  async del(namespace: string, key: string): Promise<void> {
    const cacheKey = this.buildKey(namespace, key);

    if (this.redisConnected && this.redis) {
      try {
        await this.redis.del(cacheKey);
      } catch (err: any) {
        logger.warn(`[CACHE] Redis delete failed: ${err.message}`);
      }
    }

    this.memoryCache.del(cacheKey);
  }

  /**
   * Clear all keys under a namespace
   */
  async clearNamespace(namespace: string): Promise<void> {
    try {
      if (this.redisConnected && this.redis) {
        const keys = await this.redis.keys(`${namespace}:*`);
        if (keys.length > 0) await this.redis.del(keys);
      }
      const memKeys = this.memoryCache.keys().filter((k) => k.startsWith(namespace));
      this.memoryCache.del(memKeys);
      logger.info(`[CACHE] Cleared namespace '${namespace}'.`);
    } catch (err: any) {
      logger.error(`[CACHE] Failed to clear namespace: ${err.message}`);
    }
  }

  /**
   * Check health and stats
   */
  async healthCheck() {
    return {
      redis: this.redisConnected ? "connected" : "disconnected",
      memoryCacheKeys: this.memoryCache.keys().length,
      uptime: this.memoryCache.getStats(),
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.redis) await this.redis.quit().catch(() => {});
    this.memoryCache.close();
    logger.info("🧹 Cache system shutdown complete.");
  }
}

export const cache = new CacheManager();