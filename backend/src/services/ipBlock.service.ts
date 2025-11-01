// src/services/ipBlock.service.ts
/**
 * IP Block Service (Enterprise Security Layer)
 * -------------------------------------------------------------
 * Centralized management of temporary & permanent IP bans.
 * Used by:
 *   - rateLimit.middleware.ts
 *   - trialAudit.service.ts
 *   - auth/login flood protection
 *   - superAdmin dashboards (for review & unblocking)
 *
 * Features:
 * ✅ Redis + in-memory fallback
 * ✅ Temporary and permanent block support
 * ✅ Full audit trail via auditService
 * ✅ Auto-cleanup of expired entries in memory
 * ✅ Lightweight & thread-safe design
 * -------------------------------------------------------------
 */

import { logger } from "../logger";
import { auditService } from "./audit.service";

let redisClient: any = null;

// Memory fallback (for local/dev)
const memoryBlockList = new Map<string, { reason: string; expiresAt?: number }>();

/* ------------------------------------------------------------
   🔌 Redis Initialization (Optional)
------------------------------------------------------------- */
try {
  const IORedis = require("ioredis");
  if (process.env.REDIS_URL) {
    redisClient = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    redisClient.on("connect", () => logger.info("[IPBlock] ✅ Connected to Redis"));
    redisClient.on("error", (err: any) =>
      logger.warn("[IPBlock] ⚠️ Redis error, using in-memory fallback:", err.message)
    );
  } else {
    logger.warn("[IPBlock] Redis URL not found, using in-memory fallback.");
  }
} catch {
  logger.warn("[IPBlock] Redis not available, using in-memory fallback.");
}

/* ------------------------------------------------------------
   🧠 IP Block Service
------------------------------------------------------------- */
export const ipBlockService = {
  /**
   * 🚫 Temporarily block an IP for a given duration.
   * @param ip IP address to block
   * @param reason Reason for blocking
   * @param ttlSeconds Duration in seconds (default: 10 minutes)
   */
  async blockTemporary(ip: string, reason: string, ttlSeconds = 600) {
    try {
      if (redisClient) {
        await redisClient.setex(`block:temp:${ip}`, ttlSeconds, reason);
      } else {
        memoryBlockList.set(ip, { reason, expiresAt: Date.now() + ttlSeconds * 1000 });
      }

      await auditService.log({
        actorId: "system",
        actorRole: "security",
        action: "IP_BLOCK_TEMP",
        ip,
        details: { reason, ttlSeconds },
      });

      logger.warn(`[IPBlock] 🔒 Temporarily blocked IP ${ip} (${reason}) for ${ttlSeconds}s`);
    } catch (err: any) {
      logger.error("[IPBlock] Failed to temporarily block IP:", err.message);
    }
  },

  /**
   * 🛑 Permanently block an IP (until manually unblocked)
   */
  async blockPermanent(ip: string, reason: string) {
    try {
      if (redisClient) {
        await redisClient.set(`block:perm:${ip}`, reason);
      } else {
        memoryBlockList.set(ip, { reason });
      }

      await auditService.log({
        actorId: "system",
        actorRole: "security",
        action: "IP_BLOCK_PERM",
        ip,
        details: { reason },
      });

      logger.error(`[IPBlock] 🛑 Permanently blocked IP ${ip} (${reason})`);
    } catch (err: any) {
      logger.error("[IPBlock] Failed to permanently block IP:", err.message);
    }
  },

  /**
   * ♻️ Remove an IP from all block lists (manual unblock)
   */
  async unblock(ip: string) {
    try {
      if (redisClient) {
        await Promise.all([
          redisClient.del(`block:temp:${ip}`),
          redisClient.del(`block:perm:${ip}`),
        ]);
      }
      memoryBlockList.delete(ip);

      await auditService.log({
        actorId: "system",
        actorRole: "security",
        action: "IP_UNBLOCK",
        ip,
      });

      logger.info(`[IPBlock] ✅ Unblocked IP ${ip}`);
    } catch (err: any) {
      logger.error("[IPBlock] Failed to unblock IP:", err.message);
    }
  },

  /**
   * 🔍 Check if an IP is currently blocked.
   * Returns { blocked: boolean, reason?: string, permanent?: boolean }
   */
  async isBlocked(ip: string): Promise<{ blocked: boolean; reason?: string; permanent?: boolean }> {
    try {
      if (redisClient) {
        const perm = await redisClient.get(`block:perm:${ip}`);
        if (perm) return { blocked: true, reason: perm, permanent: true };

        const temp = await redisClient.get(`block:temp:${ip}`);
        if (temp) return { blocked: true, reason: temp, permanent: false };
      } else {
        const entry = memoryBlockList.get(ip);
        if (entry) {
          if (entry.expiresAt && entry.expiresAt < Date.now()) {
            memoryBlockList.delete(ip);
            return { blocked: false };
          }
          return { blocked: true, reason: entry.reason, permanent: !entry.expiresAt };
        }
      }
      return { blocked: false };
    } catch (err: any) {
      logger.error("[IPBlock] isBlocked() error:", err.message);
      return { blocked: false };
    }
  },

  /**
   * 🧹 Cleanup expired temporary blocks (memory mode only)
   */
  cleanup() {
    const now = Date.now();
    for (const [ip, record] of memoryBlockList.entries()) {
      if (record.expiresAt && record.expiresAt < now) {
        memoryBlockList.delete(ip);
      }
    }
    if (memoryBlockList.size > 1000) {
      logger.debug(`[IPBlock] Cleaned up expired entries. Current size: ${memoryBlockList.size}`);
    }
  },
};

// Periodic cleanup (for memory mode)
if (!redisClient) {
  setInterval(() => ipBlockService.cleanup(), 60_000).unref();
}