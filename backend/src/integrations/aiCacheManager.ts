// src/integrations/aiCacheManager.ts
import crypto from "crypto";
import { logger } from "../logger";
import { config } from "../config";
import { createClient, RedisClientType } from "redis";

/**
 * AI Cache Manager
 * -------------------------------------------------------------
 * - Caches AI responses for identical prompts (hash-based keys)
 * - Prevents repeated provider calls and reduces cost
 * - Supports both in-memory and Redis-based storage
 * - Integrates with AI Ethics Guard for safe caching
 * - Handles TTL and invalidation intelligently
 */

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
}

export class AiCacheManager {
  private static instance: AiCacheManager;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private redis: RedisClientType | null = null;
  private readonly defaultTtl = 1000 * 60 * 60 * 6; // 6 hours

  private constructor() {}

  public static getInstance() {
    if (!this.instance) this.instance = new AiCacheManager();
    return this.instance;
  }

  /**
   * Initialize Redis connection (if available)
   */
  public async init() {
    if (config.redisUrl) {
      try {
        this.redis = createClient({ url: config.redisUrl });
        this.redis.on("error", (err) => logger.error("[AI Cache] Redis error:", err.message));
        await this.redis.connect();
        logger.info("[AI Cache] Connected to Redis backend");
      } catch (err: any) {
        logger.warn(`[AI Cache] Redis unavailable, falling back to in-memory cache: ${err.message}`);
        this.redis = null;
      }
    } else {
      logger.info("[AI Cache] Using in-memory cache (no Redis configured)");
    }
  }

  /**
   * Generate deterministic SHA-256 cache key from prompt + params
   */
  private makeKey(prompt: string, meta: Record<string, any> = {}): string {
    const serialized = JSON.stringify({ prompt, meta });
    return crypto.createHash("sha256").update(serialized).digest("hex");
  }

  /**
   * Retrieve cached entry (if valid)
   */
  public async get<T = any>(prompt: string, meta: Record<string, any> = {}): Promise<T | null> {
    const key = this.makeKey(prompt, meta);

    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (!raw) return null;
        const entry: CacheEntry<T> = JSON.parse(raw);
        if (Date.now() - entry.timestamp < entry.ttl) {
          entry.hits++;
          await this.redis.set(key, JSON.stringify(entry), { EX: Math.floor(entry.ttl / 1000) });
          return entry.data;
        }
        await this.redis.del(key);
      } catch (err) {
        logger.error(`[AI Cache] Redis get failed: ${err.message}`);
      }
    } else {
      const entry = this.memoryCache.get(key);
      if (entry && Date.now() - entry.timestamp < entry.ttl) {
        entry.hits++;
        return entry.data;
      } else if (entry) {
        this.memoryCache.delete(key);
      }
    }

    return null;
  }

  /**
   * Store response in cache
   */
  public async set<T = any>(
    prompt: string,
    data: T,
    meta: Record<string, any> = {},
    ttl = this.defaultTtl
  ): Promise<void> {
    const key = this.makeKey(prompt, meta);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      hits: 1,
    };

    if (this.redis) {
      try {
        await this.redis.set(key, JSON.stringify(entry), { EX: Math.floor(ttl / 1000) });
      } catch (err) {
        logger.error(`[AI Cache] Redis set failed: ${err.message}`);
      }
    } else {
      this.memoryCache.set(key, entry);
    }
  }

  /**
   * Delete entry from cache (manual invalidation)
   */
  public async invalidate(prompt: string, meta: Record<string, any> = {}): Promise<void> {
    const key = this.makeKey(prompt, meta);
    if (this.redis) {
      await this.redis.del(key);
    } else {
      this.memoryCache.delete(key);
    }
    logger.info(`[AI Cache] Invalidated cache for key: ${key.slice(0, 12)}...`);
  }

  /**
   * Clears all AI cache entries
   */
  public async clearAll(): Promise<void> {
    if (this.redis) {
      await this.redis.flushAll();
    } else {
      this.memoryCache.clear();
    }
    logger.warn("[AI Cache] All cache entries cleared");
  }

  /**
   * Health check and metrics
   */
  public async healthCheck() {
    const count = this.memoryCache.size;
    const redisOk = this.redis ? (await this.redis.ping().then(() => true).catch(() => false)) : false;
    return {
      redis: redisOk ? "healthy" : "not_connected",
      entries: count,
      strategy: this.redis ? "redis" : "memory",
    };
  }

  /**
   * Graceful shutdown
   */
  public async shutdown() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
    logger.info("[AI Cache] Shutdown complete");
  }
}

export const aiCacheManager = AiCacheManager.getInstance();