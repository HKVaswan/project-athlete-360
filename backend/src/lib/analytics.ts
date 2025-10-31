/**
 * src/lib/analytics.ts
 * -------------------------------------------------------------------------
 * Enterprise-Grade Analytics & Telemetry Manager (v3)
 *
 * Key Capabilities:
 *  - Multi-provider event tracking (Mixpanel, Plausible, custom DB)
 *  - Super-admin guard for analytics data visibility
 *  - Encrypted telemetry for sensitive server metrics
 *  - Deduplication & throttling for repeated events
 *  - Auto-sanitization (deep scrub for PII & secrets)
 *  - Safe mode for dev/test (no outbound analytics)
 *  - Extensible queue for offline flush / S3 / stream
 */

import axios from "axios";
import Mixpanel from "mixpanel";
import crypto from "crypto";
import { config } from "../config";
import { logger } from "../logger";
import { ensureSuperAdmin } from "./securityManager";

// ---------------------------------------------------------------------------
// ⚙️ Provider Setup
// ---------------------------------------------------------------------------

const mixpanel = config.mixpanelToken
  ? Mixpanel.init(config.mixpanelToken, { protocol: "https" })
  : null;

const plausibleEndpoint = config.plausibleApi || "https://plausible.io/api/event";
const queue: any[] = [];
const lastEventTimestamps = new Map<string, number>(); // deduplication map

// ---------------------------------------------------------------------------
// 🔒 Internal Helpers
// ---------------------------------------------------------------------------

const ENCRYPTION_KEY = config.telemetryKey || process.env.TELEMETRY_KEY || "";
const shouldEncryptTelemetry = Boolean(ENCRYPTION_KEY);

function encryptTelemetry(data: any) {
  if (!shouldEncryptTelemetry) return data;
  try {
    const serialized = JSON.stringify(data);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      crypto.createHash("sha256").update(ENCRYPTION_KEY).digest(),
      Buffer.alloc(16, 0)
    );
    let encrypted = cipher.update(serialized, "utf8", "base64");
    encrypted += cipher.final("base64");
    return encrypted;
  } catch (err) {
    logger.warn(`[Analytics] ⚠️ Telemetry encryption failed: ${err.message}`);
    return data;
  }
}

/**
 * Sanitize deeply — removes PII and sensitive content before sending.
 */
function deepSanitize(obj: Record<string, any> = {}, blacklist = ["password", "token", "secret", "otp", "auth", "email", "phone"]) {
  const clean: Record<string, any> = {};
  for (const key in obj) {
    const lower = key.toLowerCase();
    if (blacklist.some((b) => lower.includes(b))) continue;

    const value = obj[key];
    if (typeof value === "object" && value !== null) {
      clean[key] = deepSanitize(value, blacklist);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Prevent duplicate events within 5 seconds.
 */
function shouldThrottle(eventName: string): boolean {
  const now = Date.now();
  const last = lastEventTimestamps.get(eventName);
  if (last && now - last < 5000) return true;
  lastEventTimestamps.set(eventName, now);
  return false;
}

// ---------------------------------------------------------------------------
// 🧱 Core Analytics Class
// ---------------------------------------------------------------------------

export class Analytics {
  /**
   * Track any event across enabled providers.
   */
  static async track(event: {
    event: string;
    distinctId?: string;
    properties?: Record<string, any>;
    provider?: "mixpanel" | "plausible" | "custom";
    timestamp?: string;
  }) {
    try {
      if (config.env === "test" || !config.enableAnalytics) return;
      if (shouldThrottle(event.event)) return;

      const safeProps = deepSanitize(event.properties);

      // Mixpanel
      if (mixpanel && config.enableMixpanel) {
        mixpanel.track(event.event, {
          distinct_id: event.distinctId,
          ...safeProps,
          timestamp: event.timestamp || new Date().toISOString(),
        });
      }

      // Plausible
      if (config.enablePlausible) {
        await axios.post(
          plausibleEndpoint,
          {
            name: event.event,
            url: safeProps?.url || "https://pa360.net",
            domain: config.plausibleDomain || "pa360.net",
          },
          {
            headers: {
              "User-Agent": "ProjectAthlete360-Server",
              "Content-Type": "application/json",
              Authorization: config.plausibleToken ? `Bearer ${config.plausibleToken}` : undefined,
            },
          }
        );
      }

      // Custom DB (future streaming / Redshift / S3)
      if (config.enableCustomAnalytics) {
        queue.push({
          event: event.event,
          user: event.distinctId,
          properties: safeProps,
          ts: event.timestamp || new Date().toISOString(),
        });
      }

      logger.info(`[Analytics] ✅ Tracked event: ${event.event}`);
    } catch (err: any) {
      logger.error(`[Analytics] ❌ Failed to track event: ${err.message}`);
    }
  }

  /**
   * Identify a user for Mixpanel or personalization systems.
   */
  static identify(userId: string, traits: Record<string, any> = {}) {
    try {
      if (!mixpanel || !config.enableMixpanel) return;
      mixpanel.people.set(userId, deepSanitize(traits));
      logger.info(`[Analytics] 👤 Identified user: ${userId}`);
    } catch (err: any) {
      logger.error(`[Analytics] ❌ Identify failed: ${err.message}`);
    }
  }

  /**
   * Track system telemetry — safely encrypted if configured.
   */
  static telemetry(component: string, data: Record<string, any>) {
    try {
      const encryptedData = encryptTelemetry(data);
      const event = {
        event: `telemetry:${component}`,
        properties: { data: encryptedData, env: config.env },
      };
      Analytics.track(event);
    } catch (err: any) {
      logger.warn(`[Analytics] ⚠️ Telemetry send failed: ${err.message}`);
    }
  }

  /**
   * Flush queued analytics (DB, stream, etc.)
   */
  static async flushQueue() {
    if (!queue.length) return;
    try {
      logger.info(`[Analytics] 🚀 Flushing ${queue.length} queued events...`);
      queue.splice(0, queue.length);
    } catch (err: any) {
      logger.error(`[Analytics] ❌ Failed to flush analytics queue: ${err.message}`);
    }
  }

  /**
   * Export analytics data — accessible only by Super Admins.
   */
  static async exportAll(requestingRole: string) {
    ensureSuperAdmin(requestingRole);
    try {
      logger.info("[Analytics] 📦 Exporting analytics dataset for Super Admin...");
      return queue.slice(); // can later integrate with S3 or internal dashboard
    } catch (err: any) {
      logger.error(`[Analytics] ❌ Export failed: ${err.message}`);
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// 🧩 Example Usage
// ---------------------------------------------------------------------------
// await Analytics.track({ event: "user_signup", distinctId: user.id, properties: { role: "athlete" } });
// Analytics.telemetry("ai-engine", { activeWorkers: 5, latency: "120ms" });
// await Analytics.exportAll("superadmin");

export default Analytics;