/**
 * src/config/sessionConfig.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Session Configuration (Redis-backed)
 *
 * Responsibilities:
 *  - Centralize session handling for API servers.
 *  - Store sessions in Redis for horizontal scalability.
 *  - Auto-adapt secure flags & lifetimes per environment.
 *  - Support Express + Connect-Redis (or ioredis-based stores).
 *  - Enforce tamper-proof signing & optional rolling sessions.
 * --------------------------------------------------------------------------
 */

import session from "express-session";
import connectRedis from "connect-redis";
import Redis from "ioredis";
import { logger } from "../logger";
import { config } from "./index";

/* ------------------------------------------------------------------------
   ⚙️ Redis Client Initialization
------------------------------------------------------------------------ */
const redisUrl =
  process.env.REDIS_SESSION_URL ||
  process.env.REDIS_URL ||
  config.redisUrl ||
  "redis://127.0.0.1:6379";

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  reconnectOnError: () => true,
});

redis.on("connect", () => logger.info("[SESSION] ✅ Redis connected for session store"));
redis.on("error", (err) => logger.error("[SESSION] ❌ Redis connection error:", err.message));

/* ------------------------------------------------------------------------
   🧩 Session Store Configuration
------------------------------------------------------------------------ */
const RedisStore = connectRedis(session);

export const sessionStore = new RedisStore({
  client: redis,
  prefix: "{pa360:sess}:",
  ttl: Number(process.env.SESSION_TTL_SEC || 60 * 60 * 24 * 7), // default: 7 days
  disableTouch: false, // touch resets expiry on activity
});

/* ------------------------------------------------------------------------
   🔐 Secure Session Options
------------------------------------------------------------------------ */
const isProd = config.nodeEnv === "production";
const isSecureCookie = isProd || process.env.COOKIE_SECURE === "true";
const sameSitePolicy: "lax" | "strict" | "none" =
  process.env.COOKIE_SAMESITE === "none" ? "none" : isSecureCookie ? "none" : "lax";

/**
 * Express-session middleware factory.
 * Returns a fully configured session middleware ready for app.use().
 */
export const sessionMiddleware = session({
  store: sessionStore,
  name: process.env.SESSION_COOKIE_NAME || "pa360.sid",
  secret:
    process.env.SESSION_SECRET ||
    config.sessionSecret ||
    (() => {
      logger.warn("[SESSION] ⚠️ Missing SESSION_SECRET – generating ephemeral one.");
      return require("crypto").randomBytes(32).toString("hex");
    })(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true, // for reverse proxies (NGINX, CloudFront)
  cookie: {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: sameSitePolicy,
    maxAge: Number(process.env.SESSION_MAXAGE_MS || 1000 * 60 * 60 * 24 * 7), // 7 days
    domain: process.env.COOKIE_DOMAIN || undefined,
  },
});

/* ------------------------------------------------------------------------
   🧠 Helper: Session Health Check
------------------------------------------------------------------------ */
export const verifySessionHealth = async (): Promise<{
  ok: boolean;
  latencyMs?: number;
  message?: string;
}> => {
  try {
    const start = Date.now();
    const testKey = "pa360:session:healthcheck";
    await redis.set(testKey, "ok", "EX", 10);
    const value = await redis.get(testKey);
    const latency = Date.now() - start;

    if (value !== "ok") throw new Error("Unexpected value from Redis");
    return { ok: true, latencyMs: latency, message: "Redis session store operational" };
  } catch (err: any) {
    logger.error("[SESSION] ❌ Health check failed:", err.message);
    return { ok: false, message: err.message };
  }
};

/* ------------------------------------------------------------------------
   🚀 Usage Example
------------------------------------------------------------------------ */
/**
 * import express from "express";
 * import { sessionMiddleware } from "./config/sessionConfig";
 *
 * const app = express();
 * app.use(sessionMiddleware);
 *
 * app.get("/me", (req, res) => {
 *   if (!req.session.user) return res.status(401).send("Unauthorized");
 *   res.json({ user: req.session.user });
 * });
 */

export default {
  redis,
  sessionStore,
  sessionMiddleware,
  verifySessionHealth,
};