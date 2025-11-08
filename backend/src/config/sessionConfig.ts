// src/config/sessionConfig.ts
/**
 * src/config/sessionConfig.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Session Configuration (Redis-backed)
 *
 * - Redis-backed sessions (connect-redis + ioredis)
 * - Secure cookie flags auto-adapt per environment
 * - Enforces explicit SESSION_SECRET in production
 * - In-memory ephemeral secret permitted only in non-production (with warning)
 * - Health-check, graceful shutdown, and telemetry hooks
 * --------------------------------------------------------------------------
 */

import session from "express-session";
import connectRedis from "connect-redis";
import IORedis, { RedisOptions } from "ioredis";
import { logger } from "../logger";
import { config } from "./index";
import { telemetry } from "../lib/telemetry";

const RedisStore = connectRedis(session);

const SESSION_SECRET =
  process.env.SESSION_SECRET || config.sessionSecret || undefined;

const isProd = (config.nodeEnv || process.env.NODE_ENV) === "production";

if (isProd && !SESSION_SECRET) {
  // In production we must not continue without a persistent secret
  logger.error(
    "[SESSION] ❌ SESSION_SECRET is required in production. Please set process.env.SESSION_SECRET."
  );
  throw new Error("SESSION_SECRET is required in production");
}

// If secret is missing in non-prod, create ephemeral but warn loudly
const sessionSecretFinal =
  SESSION_SECRET ??
  (() => {
    const s = require("crypto").randomBytes(32).toString("hex");
    logger.warn(
      "[SESSION] ⚠️ SESSION_SECRET not set — using ephemeral secret (non-production only). Do NOT use in production."
    );
    return s;
  })();

/* --------------------------------------------------------------------------
 * Redis connection options (sane defaults)
 * -------------------------------------------------------------------------- */
const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  reconnectOnError: () => true,
  lazyConnect: true, // connect explicitly to control lifecycle
  // TLS handled externally via config.redisTls and tls options if required
  ...(config.redisTls ? { tls: {} } : {}),
};

const redisUrl =
  process.env.REDIS_SESSION_URL ||
  process.env.REDIS_URL ||
  config.redisUrl ||
  "redis://127.0.0.1:6379";

const redis = new IORedis(redisUrl, redisOptions);

/* --------------------------------------------------------------------------
 * Async connect, with guarded retries and logging
 * -------------------------------------------------------------------------- */
(async () => {
  try {
    // Try to connect; don't block server start (but log clearly)
    await redis.connect().catch((err) => {
      // connect() may reject if already connected or if lazy connect is false
      logger.warn("[SESSION] Redis connect returned:", err?.message || err);
    });
    logger.info("[SESSION] ✅ Redis connection (session store) initialized");
  } catch (err: any) {
    logger.error("[SESSION] ❌ Redis initialization error:", err?.message || err);
  }
})();

redis.on("connect", () => logger.info("[SESSION] Redis (session) connecting..."));
redis.on("ready", () => logger.info("[SESSION] Redis (session) ready"));
redis.on("error", (err) => logger.error("[SESSION] Redis (session) error:", err?.message || err));
redis.on("end", () => logger.warn("[SESSION] Redis (session) connection ended"));

/* --------------------------------------------------------------------------
 * Session TTL & cookie lifetime
 * -------------------------------------------------------------------------- */
const DEFAULT_TTL_SECONDS = Number(process.env.SESSION_TTL_SEC || 60 * 60 * 24 * 7); // 7 days
const COOKIE_MAX_AGE_MS = Number(process.env.SESSION_MAXAGE_MS || DEFAULT_TTL_SECONDS * 1000);

/* --------------------------------------------------------------------------
 * Cookie security settings
 * -------------------------------------------------------------------------- */
const isSecureCookie = process.env.COOKIE_SECURE === "true" || isProd;
const sameSitePolicy: "lax" | "strict" | "none" =
  (process.env.COOKIE_SAMESITE as any) ||
  (isSecureCookie ? "none" : "lax");

const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

/* --------------------------------------------------------------------------
 * Session store instance
 * -------------------------------------------------------------------------- */
export const sessionStore = new RedisStore({
  client: redis as any,
  prefix: (process.env.SESSION_REDIS_PREFIX || "{pa360:sess}:").toString(),
  ttl: DEFAULT_TTL_SECONDS,
  disableTouch: false, // allow rolling sessions to update expiry
});

/* --------------------------------------------------------------------------
 * Express-session middleware factory
 * -------------------------------------------------------------------------- */
export const sessionMiddleware = session({
  store: sessionStore,
  name: process.env.SESSION_COOKIE_NAME || "pa360.sid",
  secret: sessionSecretFinal,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true, // trust proxy (set via app.set('trust proxy', 1))
  cookie: {
    httpOnly: true,
    secure: isSecureCookie, // only send over HTTPS in production
    sameSite: sameSitePolicy,
    maxAge: COOKIE_MAX_AGE_MS,
    domain: cookieDomain,
  },
});

/* --------------------------------------------------------------------------
 * Health check helper for session store (used by readiness probes)
 * -------------------------------------------------------------------------- */
export const verifySessionHealth = async (): Promise<{
  ok: boolean;
  latencyMs?: number;
  message?: string;
}> => {
  const start = Date.now();
  try {
    const testKey = `${process.env.SESSION_REDIS_PREFIX || "pa360:sess:health"}:${Date.now()}`;
    await redis.set(testKey, "ok", "EX", 10);
    const v = await redis.get(testKey);
    const latency = Date.now() - start;
    if (v !== "ok") throw new Error("unexpected redis value");
    telemetry.record?.("session.store.ping_ms", latency); // optional telemetry
    return { ok: true, latencyMs: latency, message: "Session store reachable" };
  } catch (err: any) {
    logger.error("[SESSION] Health check failed:", err?.message || err);
    telemetry.record?.("session.store.failure", 1);
    return { ok: false, message: err?.message || String(err) };
  }
};

/* --------------------------------------------------------------------------
 * Graceful shutdown for session Redis client
 * -------------------------------------------------------------------------- */
const shutdown = async () => {
  try {
    logger.info("[SESSION] Shutting down session Redis client...");
    if (redis && typeof redis.quit === "function") {
      await (redis as any).quit();
      logger.info("[SESSION] Session Redis client quit");
    }
  } catch (err: any) {
    logger.warn("[SESSION] Error while shutting down session Redis client:", err?.message || err);
    try {
      (redis as any).disconnect();
    } catch {}
  }
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

/* --------------------------------------------------------------------------
 * Usage: app.use(sessionMiddleware)
 * - Ensure app.set('trust proxy', 1) if behind a proxy/load-balancer (for secure cookies)
 * - Enforce persistent SESSION_SECRET in production (rotate with care)
 * - Consider: regenerate session on privilege changes (login, role escalation)
 * -------------------------------------------------------------------------- */

export default {
  redis,
  sessionStore,
  sessionMiddleware,
  verifySessionHealth,
};