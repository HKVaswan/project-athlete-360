/**
 * src/lib/redisClient.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise-Grade Redis Client (v3)
 *
 * Features:
 *  - Singleton Redis/Cluster client via ioredis
 *  - Resilient retry + exponential backoff
 *  - Cluster & Sentinel support
 *  - Health check & graceful shutdown
 *  - Integrated OpenTelemetry & Prometheus metrics
 *  - Circuit breaker for repeated connection failures
 * --------------------------------------------------------------------------
 */

import IORedis, { Redis, Cluster, RedisOptions, ClusterNode } from "ioredis";
import { config } from "../config";
import { logger } from "../logger";
import { context, trace } from "@opentelemetry/api";
import { recordError } from "./core/metrics";
import { auditService } from "../services/audit.service";

let client: Redis | Cluster | null = null;
let isShuttingDown = false;

// Circuit breaker state
let failureCount = 0;
let circuitOpen = false;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;

/* -----------------------------------------------------------------------
   🧩 Redis Configuration Builder
------------------------------------------------------------------------ */
const buildOptions = (): RedisOptions => ({
  enableReadyCheck: true,
  lazyConnect: false,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
  connectTimeout: Number(config.redisConnectTimeout || 10_000),
  keepAlive: 30,
  tls: config.redisTls ? {} : undefined,
  keyPrefix: config.redisKeyPrefix || undefined,
  maxRetriesPerRequest: 20,
  retryStrategy: (times: number) => {
    const delay = Math.min(2000, Math.pow(2, Math.min(times, 8)) * 200);
    return delay;
  },
});

/* -----------------------------------------------------------------------
   🚀 Initialize Singleton Client
------------------------------------------------------------------------ */
export const getRedis = (): Redis | Cluster => {
  if (client) return client;

  const opts = buildOptions();
  try {
    const clusterNodesEnv = config.redisClusterNodes;
    if (clusterNodesEnv) {
      // Parse cluster node list
      let nodes: ClusterNode[] = [];
      if (typeof clusterNodesEnv === "string") {
        try {
          nodes = JSON.parse(clusterNodesEnv);
        } catch {
          nodes = clusterNodesEnv.split(",").map((s) => {
            const [host, port] = s.trim().split(":");
            return { host, port: Number(port || 6379) };
          });
        }
      } else if (Array.isArray(clusterNodesEnv)) {
        nodes = clusterNodesEnv;
      }

      logger.info(`[redis] Initializing Redis Cluster (${nodes.length} nodes)`);
      client = new Cluster(nodes, { redisOptions: opts });
    } else {
      const url = config.redisUrl;
      if (url) {
        logger.info(`[redis] Connecting to Redis via URL`);
        client = new IORedis(url, opts);
      } else {
        const host = config.redisHost || "127.0.0.1";
        const port = Number(config.redisPort || 6379);
        logger.info(`[redis] Connecting to Redis at ${host}:${port}`);
        client = new IORedis(port, host, opts);
      }
    }

    attachEventHandlers(client);
    return client;
  } catch (err: any) {
    logger.error("[redis] ❌ Initialization failed:", err);
    recordError("redis_init_failure", "high");
    throw err;
  }
};

/* -----------------------------------------------------------------------
   🧭 Event Handlers & Circuit Breaker
------------------------------------------------------------------------ */
const attachEventHandlers = (c: Redis | Cluster) => {
  (c as any).on("connect", () => {
    logger.info("[redis] 🟢 Connecting...");
    failureCount = 0;
  });

  (c as any).on("ready", () => {
    logger.info("[redis] ✅ Ready");
    circuitOpen = false;
  });

  (c as any).on("reconnecting", (delay: number) => {
    logger.warn(`[redis] ♻️ Reconnecting in ${delay}ms`);
  });

  (c as any).on("error", async (err: Error) => {
    logger.error("[redis] ❌ Error:", err.message);
    recordError("redis_error", "medium");
    failureCount++;

    if (failureCount >= CIRCUIT_THRESHOLD && !circuitOpen) {
      circuitOpen = true;
      logger.warn("[redis] ⚠️ Circuit opened due to repeated failures");
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "REDIS_CIRCUIT_OPENED",
        details: { error: err.message, failureCount },
      });

      setTimeout(() => {
        failureCount = 0;
        circuitOpen = false;
        logger.info("[redis] 🔄 Circuit reset");
      }, CIRCUIT_RESET_TIMEOUT_MS);
    }
  });

  (c as any).on("end", () => logger.warn("[redis] 🔴 Connection ended"));
  (c as any).on("close", () => logger.warn("[redis] 🔒 Connection closed"));
};

/* -----------------------------------------------------------------------
   🧠 Health Check
------------------------------------------------------------------------ */
export const healthCheck = async (opts?: { timeoutMs?: number }) => {
  const timeoutMs = opts?.timeoutMs ?? 3000;
  const span = trace.getTracer("infra").startSpan("redis.healthCheck", undefined, context.active());

  try {
    if (circuitOpen) throw new Error("Circuit open – skipping Redis health check");

    const r = getRedis();
    const pingPromise = async () => {
      if ((r as any).nodes) {
        const masters = (r as any).nodes("master") as Redis[];
        for (const node of masters) {
          const pong = await node.ping().catch(() => null);
          if (pong?.toLowerCase().includes("pong")) return true;
        }
        throw new Error("Redis cluster PING failed");
      } else {
        const pong = await (r as Redis).ping();
        if (!pong.toLowerCase().includes("pong")) throw new Error("Redis PING failed");
      }
      return true;
    };

    await Promise.race([
      pingPromise(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis health timeout")), timeoutMs)),
    ]);

    span.setStatus({ code: 1, message: "Healthy" });
    span.end();
    return true;
  } catch (err: any) {
    recordError("redis_health_check_failed", "critical");
    logger.error("[redis] ⚠️ Health check failed:", err.message);
    span.setStatus({ code: 2, message: err.message });
    span.end();
    throw err;
  }
};

/* -----------------------------------------------------------------------
   🧹 Graceful Shutdown
------------------------------------------------------------------------ */
export const shutdownRedis = async (force = false) => {
  if (!client || (isShuttingDown && !force)) return;
  isShuttingDown = true;

  try {
    logger.info("[redis] 🧹 Shutting down...");
    await (client as any).quit();
    logger.info("[redis] ✅ Redis shutdown complete.");
  } catch (err: any) {
    logger.warn("[redis] ⚠️ Quit failed, forcing disconnect:", err.message);
    try {
      (client as any).disconnect();
    } catch {}
  } finally {
    client = null;
  }
};

/* -----------------------------------------------------------------------
   🔧 Utility Export
------------------------------------------------------------------------ */
export const redisClient = (): Redis | Cluster => getRedis();

process.once("SIGINT", () => void shutdownRedis());
process.once("SIGTERM", () => void shutdownRedis());
process.once("SIGQUIT", () => void shutdownRedis());

export default {
  getRedis,
  redisClient,
  healthCheck,
  shutdownRedis,
};