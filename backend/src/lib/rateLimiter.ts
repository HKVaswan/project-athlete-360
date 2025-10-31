// src/lib/rateLimiter.ts
/**
 * Enterprise-grade Rate Limiter (Sliding Window) using Redis ZSET.
 *
 * - Sliding window implementation (fairer than fixed window).
 * - Each key is a ZSET with timestamps of events.
 * - On each request:
 *    1) Remove entries older than (now - window)
 *    2) Add current timestamp
 *    3) Count items -> if <= limit -> allowed
 * - Returns metadata: allowed, remaining, retryAfterSeconds, consumed
 * - Provides in-memory fallback when Redis is unavailable (best-effort, conservative)
 * - Safe defaults and TTL housekeeping.
 *
 * Usage:
 *   const rl = new RateLimiter(redisClient);
 *   const res = await rl.consume('login:ip:1.2.3.4', { limit: 10, windowSec: 60 });
 *   if (!res.allowed) return 429 with res.retryAfterSeconds
 *
 * Notes:
 *  - Keys should be namespaced: e.g. "rl:login:ip:<ip>" or use securityManager.rateLimitKey()
 *  - Keep the window reasonably small to avoid large ZSET sizes.
 */

import IORedis from "ioredis";
import { config } from "../config";
import logger from "../logger";
import securityManager from "./securityManager";

type ConsumeOpts = {
  limit: number; // max events allowed in window
  windowSec: number; // sliding window size in seconds
  // optionally return the exact timestamp to log
};

type ConsumeResult = {
  allowed: boolean;
  consumed: number;
  remaining: number;
  retryAfterSeconds: number | null;
  resetAt: number | null; // epoch ms when window will reset for this key
};

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW = 60; // seconds

// in-memory fallback store structure
type InMemoryEntry = {
  timestamps: number[]; // epoch ms
};

class RateLimiter {
  redis?: IORedis.Redis | null;
  enabled: boolean;
  inMemory: Map<string, InMemoryEntry>;
  cleanupIntervalId?: NodeJS.Timeout;

  constructor(redisClient?: IORedis.Redis | null) {
    this.redis = redisClient ?? null;
    this.enabled = !!redisClient;
    this.inMemory = new Map();

    // Periodically trim in-memory store to avoid memory leaks
    this.cleanupIntervalId = setInterval(() => this._cleanupMemory(), 60 * 1000).unref();
  }

  private _cleanupMemory() {
    try {
      const now = Date.now();
      const maxKeepMs = 1000 * 60 * 60; // keep up to 1 hour for safety
      for (const [k, v] of this.inMemory.entries()) {
        v.timestamps = v.timestamps.filter((t) => now - t <= maxKeepMs);
        if (v.timestamps.length === 0) this.inMemory.delete(k);
      }
    } catch (err) {
      logger.warn("[RateLimiter] in-memory cleanup failed", err);
    }
  }

  /**
   * Consume one token for key under given limit/window.
   * Returns metadata and whether allowed.
   */
  public async consume(key: string, opts?: Partial<ConsumeOpts>): Promise<ConsumeResult> {
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    const windowSec = opts?.windowSec ?? DEFAULT_WINDOW;

    if (this.enabled && this.redis) {
      try {
        return await this._consumeRedis(key, limit, windowSec);
      } catch (err) {
        // degrade gracefully to in-memory fallback (conservative)
        logger.error(`[RateLimiter] Redis consume failed for ${key} — falling back to memory.`, err);
        this.enabled = false; // mark as disabled to avoid repeated redis errors
        return this._consumeMemory(key, limit, windowSec);
      }
    } else {
      return this._consumeMemory(key, limit, windowSec);
    }
  }

  /**
   * Redis-backed sliding window consumption using ZSET.
   *
   * Lua script atomicity would be ideal. We'll do a small pipeline to keep operations
   * tightly bound but not fully atomic across network — acceptable for most cases.
   */
  private async _consumeRedis(key: string, limit: number, windowSec: number): Promise<ConsumeResult> {
    if (!this.redis) throw new Error("Redis client not configured");

    const nowMs = Date.now();
    const windowStart = nowMs - windowSec * 1000;
    const zkey = `rl:${key}`;

    // We will use an atomic Lua script to ensure correctness and reduce round-trips.
    const lua = `
      local zkey = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local ttl = tonumber(ARGV[4])

      -- remove older entries
      redis.call('ZREMRANGEBYSCORE', zkey, 0, windowStart)

      -- add current hit with score=now and unique member
      -- use member as concatenation of now and random to avoid collisions
      local member = tostring(now) .. '-' .. tostring(math.random(1000000,9999999))
      redis.call('ZADD', zkey, now, member)

      -- set TTL
      redis.call('PEXPIRE', zkey, ttl)

      -- get current count
      local count = redis.call('ZCARD', zkey)

      -- get earliest entry score
      local earliest = redis.call('ZRANGE', zkey, 0, 0, 'WITHSCORES')
      local earliestScore = nil
      if earliest and #earliest >= 2 then earliestScore = tonumber(earliest[2]) end

      return { tostring(count), tostring(earliestScore or -1) }
    `;

    // ttl = windowSec*1000 + small buffer
    const ttlMs = windowSec * 1000 + 2000;

    // Run Lua
    const resp = await this.redis.eval(lua, 1, zkey, nowMs.toString(), windowStart.toString(), limit.toString(), ttlMs.toString());

    // resp is [countStr, earliestScoreStr]
    const [countStr, earliestScoreStr] = resp as [string, string];
    const count = Number(countStr);
    const earliestScore = Number(earliestScoreStr);

    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    let retryAfterSeconds: number | null = null;
    let resetAt: number | null = null;

    if (!allowed) {
      // earliestScore is epoch ms of oldest event in the window; when it falls out, a new slot opens
      if (earliestScore > 0) {
        const retryAtMs = earliestScore + windowSec * 1000;
        retryAfterSeconds = Math.max(0, Math.ceil((retryAtMs - nowMs) / 1000));
        resetAt = retryAtMs;
      } else {
        retryAfterSeconds = windowSec;
        resetAt = nowMs + windowSec * 1000;
      }
    } else {
      // allowed: compute resetAt as windowStart + window length from oldest entry (if any)
      if (earliestScore > 0) {
        resetAt = earliestScore + windowSec * 1000;
      } else {
        resetAt = nowMs + windowSec * 1000;
      }
    }

    return {
      allowed,
      consumed: count,
      remaining,
      retryAfterSeconds,
      resetAt,
    };
  }

  /**
   * Conservative in-memory fallback sliding window.
   * Not distributed — only safe for single instance or temporary fallback.
   */
  private _consumeMemory(key: string, limit: number, windowSec: number): ConsumeResult {
    const now = Date.now();
    const windowStart = now - windowSec * 1000;

    let entry = this.inMemory.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.inMemory.set(key, entry);
    }

    // prune
    entry.timestamps = entry.timestamps.filter((t) => t >= windowStart);

    // add current
    entry.timestamps.push(now);

    const count = entry.timestamps.length;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);

    let retryAfterSeconds: number | null = null;
    let resetAt: number | null = null;
    if (!allowed) {
      const earliest = entry.timestamps[0] || now;
      const retryAt = earliest + windowSec * 1000;
      retryAfterSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
      resetAt = retryAt;
    } else {
      const earliest = entry.timestamps[0] || now;
      resetAt = earliest + windowSec * 1000;
    }

    return {
      allowed,
      consumed: count,
      remaining,
      retryAfterSeconds,
      resetAt,
    };
  }

  /**
   * Helper to wrap rate-limit checks inside middleware-friendly code.
   * Example usage:
   *   const res = await limiter.checkAndConsume(req, 'login', req.ip, { limit: 10, windowSec: 60 });
   *   if (!res.allowed) return res.status(429).json({ message: 'Too many requests', retryAfter: res.retryAfterSeconds })
   */
  public async checkAndConsume(
    namespace: string,
    id: string,
    opts?: Partial<ConsumeOpts>
  ): Promise<ConsumeResult> {
    const key = `${namespace}:${id}`;
    return this.consume(key, opts);
  }

  /**
   * Shutdown the limiter (cleanup timers)
   */
  public shutdown() {
    try {
      if (this.cleanupIntervalId) clearInterval(this.cleanupIntervalId);
    } catch (err) {
      // ignore
    }
  }
}

/**
 * Factory: build instance using config.redisUrl or provided client.
 * Keep single shared instance across app.
 */
let singleton: RateLimiter | null = null;

export const createRateLimiter = (redisClient?: IORedis.Redis | null) => {
  if (!singleton) {
    let client: IORedis.Redis | null = null;
    if (redisClient) {
      client = redisClient;
    } else if (config.redisUrl) {
      client = new IORedis(config.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      });
      client.on("error", (err) => logger.error("[RateLimiter] Redis error", err));
    } else {
      client = null;
    }

    singleton = new RateLimiter(client);
  }
  return singleton;
};

export default RateLimiter;