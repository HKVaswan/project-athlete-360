/**
 * src/lib/redisClient.ts
 *
 * Enterprise-grade Redis client wrapper using ioredis.
 * - Single exported Redis instance (singleton)
 * - Robust connection options (backoff, max retries)
 * - Optional sentinel / cluster support (via env)
 * - Health check helper
 * - Graceful shutdown helper
 *
 * Usage:
 *   import { redis, healthCheck, shutdownRedis } from "../lib/redisClient";
 *   await healthCheck(); // throws if unhealthy
 */

import IORedis, { Redis, RedisOptions, Cluster, ClusterNode } from "ioredis";
import { config } from "../config";
import logger from "../logger";

let client: Redis | Cluster | null = null;
let isShuttingDown = false;

/**
 * Build redis options from config with sensible production defaults.
 */
const buildOptions = (): RedisOptions => {
  const base: RedisOptions = {
    // common sensible defaults
    maxRetriesPerRequest: null, // delegate retries to retryStrategy
    enableReadyCheck: true,
    // keepAlive in seconds
    keepAlive: 30,
    // connection timeout (ms)
    connectTimeout: Number(config.redisConnectTimeout || 10000),
    // Lazy connect: create client without immediately connecting if desired
    lazyConnect: false,
    // auto-resubscribe + autoresend commands after reconnect
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,
    // TLS (if REDIS_TLS === true)
    tls: config.redisTls ? {} : undefined,
    keyPrefix: config.redisKeyPrefix || undefined,
    // Pretty conservative command buffer size to avoid OOM in bad states
    maxRetriesPerRequest: 20,
    // custom retry strategy
    retryStrategy: (times: number) => {
      const baseDelay = 200; // ms
      // exponential backoff with cap
      const delay = Math.min(2000, Math.pow(2, Math.min(times, 8)) * baseDelay);
      return delay;
    },
  };

  return base;
};

/**
 * Initialize and return a singleton Redis client.
 * Supports:
 *  - Single node (REDIS_URL)
 *  - Cluster (REDIS_CLUSTER_NODES JSON array)
 */
export const getRedis = (): Redis | Cluster => {
  if (client) return client;

  const clusterNodesEnv = config.redisClusterNodes; // expected JSON array with { host, port }
  try {
    if (clusterNodesEnv) {
      // parse cluster nodes (supports JSON string or pre-parsed array)
      let nodes: ClusterNode[] = [];
      if (typeof clusterNodesEnv === "string") {
        // allow comma-separated host:port or JSON array
        try {
          const parsed = JSON.parse(clusterNodesEnv);
          if (Array.isArray(parsed)) nodes = parsed;
          else throw new Error("Invalid REDIS_CLUSTER_NODES JSON");
        } catch {
          // fallback to comma-separated host:port list
          nodes = (clusterNodesEnv as string)
            .split(",")
            .map((s) => {
              const [host, port] = s.trim().split(":");
              return { host, port: Number(port || 6379) };
            });
        }
      } else if (Array.isArray(clusterNodesEnv)) {
        nodes = clusterNodesEnv as any;
      }

      logger.info(`[redis] Initializing Redis Cluster with ${nodes.length} nodes`);
      client = new Cluster(nodes, {
        redisOptions: buildOptions(),
      });
    } else {
      // Single node via URL or host/port
      const url = config.redisUrl;
      const opts = buildOptions();
      if (!url) {
        const host = config.redisHost || "127.0.0.1";
        const port = Number(config.redisPort || 6379);
        logger.info(`[redis] Initializing single-node Redis at ${host}:${port}`);
        client = new IORedis(port, host, opts);
      } else {
        logger.info(`[redis] Initializing single-node Redis via URL`);
        client = new IORedis(url, opts);
      }
    }

    attachEventHandlers(client);
    return client;
  } catch (err: any) {
    logger.error("[redis] Failed to initialize Redis client", err);
    throw err;
  }
};

/**
 * Attach event handlers for logging and health monitoring
 */
const attachEventHandlers = (c: Redis | Cluster) => {
  try {
    // `on` exists for both Redis and Cluster instances
    (c as any).on("connect", () => logger.info("[redis] connecting..."));
    (c as any).on("ready", () => logger.info("[redis] ready"));
    (c as any).on("close", () => logger.warn("[redis] connection closed"));
    (c as any).on("end", () => logger.warn("[redis] connection ended"));
    (c as any).on("reconnecting", (delay: number) =>
      logger.warn(`[redis] reconnecting in ${delay}ms`)
    );
    (c as any).on("error", (err: Error) => logger.error("[redis] error:", err?.message || err));
  } catch (err) {
    // best-effort — do not crash on attach errors
    logger.error("[redis] failed to attach event handlers", err);
  }
};

/**
 * Lightweight health check for Redis.
 * - For Cluster: checks at least one master node responds to PING
 * - For single node: runs PING
 *
 * Throws Error if unhealthy.
 */
export const healthCheck = async (opts?: { timeoutMs?: number }) => {
  const timeoutMs = opts?.timeoutMs ?? 3000;
  const r = getRedis();

  const pingPromise = (async () => {
    try {
      // ioredis cluster has .nodes()
      if ((r as any).nodes && typeof (r as any).nodes === "function") {
        const masters = (r as any).nodes("master") as Redis[];
        if (!masters || masters.length === 0)
          throw new Error("No master nodes available in Redis cluster");

        // try to ping at least one master
        let ok = false;
        for (const node of masters) {
          try {
            const pong = await node.ping();
            if (typeof pong === "string" && pong.toLowerCase().includes("pong")) {
              ok = true;
              break;
            }
          } catch (err) {
            // try next node
          }
        }
        if (!ok) throw new Error("Redis cluster masters did not respond to PING");
      } else {
        const pong = await (r as Redis).ping();
        if (!pong || !String(pong).toLowerCase().includes("pong"))
          throw new Error("Redis ping failed");
      }
      return true;
    } catch (err: any) {
      throw err;
    }
  })();

  // enforce timeout
  const result = await Promise.race([
    pingPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Redis health check timeout")), timeoutMs)
    ),
  ]);

  return result as boolean;
};

/**
 * Gracefully shutdown Redis connection (used during app termination)
 */
export const shutdownRedis = async (force = false) => {
  if (!client) return;
  if (isShuttingDown && !force) return;
  isShuttingDown = true;

  try {
    logger.info("[redis] Shutting down Redis connection...");
    // good practice to quit rather than disconnect -> ensures queued commands handled
    await (client as any).quit();
    logger.info("[redis] Redis quit complete");
  } catch (err: any) {
    logger.warn("[redis] Error during quit, forcing disconnect:", err?.message || err);
    try {
      (client as any).disconnect();
    } catch (e) {
      // ignore
    }
  } finally {
    client = null;
  }
};

/**
 * Safe getter for the internal client for places that need direct access.
 * Prefer using typed wrappers rather than exporting client directly.
 */
export const redisClient = (): Redis | Cluster => {
  return getRedis();
};

/**
 * Listen for process termination to close redis gracefully
 */
const listenForShutdown = () => {
  const doShutdown = async () => {
    try {
      await shutdownRedis();
    } catch (err) {
      // ignore
    } finally {
      // do not exit the process here - caller (server.ts) should handle exit
    }
  };

  process.once("SIGINT", doShutdown);
  process.once("SIGTERM", doShutdown);
  process.once("SIGQUIT", doShutdown);
};

listenForShutdown();

export default {
  getRedis,
  redisClient,
  healthCheck,
  shutdownRedis,
};