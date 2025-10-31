// src/integrations/integrationConfig.ts

import dotenv from "dotenv";
import path from "path";
import { logger } from "../logger";

// Load environment variables from .env
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * Enterprise Integration Configuration Loader
 * --------------------------------------------------------
 * - Centralizes all external API credentials and endpoints
 * - Ensures consistent naming, fallback defaults, and logging
 * - Protects against undefined / unsafe configs at startup
 */

export const integrationConfig = {
  // ─────────────── AI INTEGRATIONS ───────────────
  ai: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || "",
      endpoint:
        process.env.GEMINI_API_URL ||
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
    },
    openRouter: {
      apiKey: process.env.OPENROUTER_API_KEY || "",
      endpoint: process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1/chat/completions",
    },
    ollama: {
      endpoint: process.env.OLLAMA_API_URL || "http://localhost:11434/api/generate",
    },
  },

  // ─────────────── EMAIL / NOTIFICATIONS ───────────────
  mail: {
    smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
    smtpPort: Number(process.env.SMTP_PORT) || 587,
    smtpUser: process.env.SMTP_USER || "",
    smtpPass: process.env.SMTP_PASS || "",
    smtpFrom: process.env.SMTP_FROM || "no-reply@pa360.net",
  },

  // ─────────────── STORAGE INTEGRATIONS ───────────────
  storage: {
    s3: {
      accessKeyId: process.env.S3_ACCESS_KEY || "",
      secretAccessKey: process.env.S3_SECRET_KEY || "",
      bucketName: process.env.S3_BUCKET || "pa360-uploads",
      region: process.env.S3_REGION || "ap-south-1",
      baseUrl: process.env.S3_BASE_URL || "",
    },
    cdn: {
      provider: process.env.CDN_PROVIDER || "cloudflare",
      apiKey: process.env.CDN_API_KEY || "",
      baseUrl: process.env.CDN_BASE_URL || "",
    },
  },

  // ─────────────── ANALYTICS & MONITORING ───────────────
  analytics: {
    mixpanelKey: process.env.MIXPANEL_API_KEY || "",
    sentryDsn: process.env.SENTRY_DSN || "",
    gaMeasurementId: process.env.GA_MEASUREMENT_ID || "",
  },

  // ─────────────── BACKUP & SYNC ───────────────
  backup: {
    backupServiceUrl: process.env.BACKUP_SERVICE_URL || "",
    restoreServiceUrl: process.env.RESTORE_SERVICE_URL || "",
    encryptionKey: process.env.BACKUP_ENCRYPTION_KEY || "",
  },

  // ─────────────── REDIS / CACHE ───────────────
  cache: {
    redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    ttl: Number(process.env.CACHE_TTL) || 300,
  },

  // ─────────────── SYSTEM & SECURITY ───────────────
  security: {
    jwtSecret: process.env.JWT_SECRET || "",
    encryptionKey: process.env.ENCRYPTION_KEY || "",
    saltRounds: Number(process.env.SALT_ROUNDS) || 10,
  },
};

/**
 * Startup validation to prevent missing keys in production.
 */
export const validateIntegrationConfig = () => {
  const critical = [
    ["AI Gemini API Key", integrationConfig.ai.gemini.apiKey],
    ["JWT Secret", integrationConfig.security.jwtSecret],
    ["SMTP User", integrationConfig.mail.smtpUser],
    ["S3 Access Key", integrationConfig.storage.s3.accessKeyId],
  ];

  for (const [name, value] of critical) {
    if (!value) {
      logger.warn(`[CONFIG] ⚠️ Missing critical config: ${name}`);
    }
  }

  logger.info(`[CONFIG] ✅ Integration configuration loaded successfully.`);
};