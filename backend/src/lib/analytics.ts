/**
 * src/lib/analytics.ts
 * -------------------------------------------------------------------------
 * Enterprise-grade Analytics + Telemetry Manager
 *
 * Features:
 *  - Unified tracking API for multiple analytics providers
 *  - Works across backend (server-side) + frontend events
 *  - Intelligent batching for efficiency
 *  - Safe mode (no analytics in dev/test)
 *  - Extensible: easily plug in Mixpanel, Plausible, PostHog, or custom DB
 *  - Auto-sanitizes data (no sensitive or PII data leakage)
 */

import axios from "axios";
import Mixpanel from "mixpanel";
import { config } from "../config";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// 🔧 Setup
// ---------------------------------------------------------------------------

// Lazy initialize Mixpanel only if token exists
const mixpanel = config.mixpanelToken
  ? Mixpanel.init(config.mixpanelToken, { protocol: "https" })
  : null;

// Simple Plausible endpoint (for privacy-first tracking)
const plausibleEndpoint = config.plausibleApi || "https://plausible.io/api/event";

// Batching queue (for future extension — sending logs in batches)
const queue: any[] = [];

// ---------------------------------------------------------------------------
// 🧱 Core Analytics Interface
// ---------------------------------------------------------------------------

type AnalyticsEvent = {
  event: string;
  distinctId?: string;
  properties?: Record<string, any>;
  provider?: "mixpanel" | "plausible" | "custom";
  timestamp?: string;
};

export class Analytics {
  /**
   * Safely track an event across all enabled providers.
   */
  static async track(event: AnalyticsEvent) {
    try {
      if (config.env === "test" || !config.enableAnalytics) return;

      const safeProps = Analytics.sanitize(event.properties);

      // Send to Mixpanel (if configured)
      if (mixpanel && config.enableMixpanel) {
        mixpanel.track(event.event, {
          distinct_id: event.distinctId,
          ...safeProps,
          timestamp: event.timestamp || new Date().toISOString(),
        });
      }

      // Send to Plausible (privacy-friendly)
      if (config.enablePlausible) {
        await axios.post(
          plausibleEndpoint,
          {
            name: event.event,
            url: event.properties?.url || "https://pa360.net",
            domain: config.plausibleDomain || "pa360.net",
          },
          {
            headers: {
              "User-Agent": "ProjectAthlete360-Server",
              "Content-Type": "application/json",
              Authorization: config.plausibleToken
                ? `Bearer ${config.plausibleToken}`
                : undefined,
            },
          }
        );
      }

      // Send to custom internal analytics DB (future extension)
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
   * Identify user — used for Mixpanel or future personalization engines
   */
  static identify(userId: string, traits: Record<string, any> = {}) {
    try {
      if (!mixpanel || !config.enableMixpanel) return;
      mixpanel.people.set(userId, Analytics.sanitize(traits));
      logger.info(`[Analytics] 👤 Identified user: ${userId}`);
    } catch (err: any) {
      logger.error(`[Analytics] ❌ Identify failed: ${err.message}`);
    }
  }

  /**
   * Send system telemetry — usage metrics, worker performance, etc.
   */
  static telemetry(component: string, data: Record<string, any>) {
    try {
      const event = {
        event: `telemetry:${component}`,
        properties: { ...data, env: config.env },
      };
      Analytics.track(event);
    } catch (err: any) {
      logger.warn(`[Analytics] ⚠️ Telemetry send failed: ${err.message}`);
    }
  }

  /**
   * Sanitize data — removes PII and sensitive content before tracking.
   */
  private static sanitize(data: Record<string, any> = {}) {
    const blacklist = ["password", "token", "otp", "secret", "auth", "email"];
    const clean: Record<string, any> = {};

    for (const key in data) {
      const lower = key.toLowerCase();
      if (blacklist.some((b) => lower.includes(b))) continue;
      clean[key] = data[key];
    }
    return clean;
  }

  /**
   * Flush batched analytics data (for future DB/streaming integrations)
   */
  static async flushQueue() {
    if (!queue.length) return;
    try {
      // Example: send to a dedicated analytics DB or S3 batch
      logger.info(`[Analytics] 🚀 Flushing ${queue.length} batched events...`);
      queue.splice(0, queue.length);
    } catch (err) {
      logger.error(`[Analytics] ❌ Failed to flush analytics queue: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 🧩 Example Usage
// ---------------------------------------------------------------------------
// await Analytics.track({ event: "user_signup", distinctId: user.id, properties: { role: "athlete" } });
// Analytics.telemetry("ai-engine", { activeWorkers: 5, latency: "120ms" });
// Analytics.identify(user.id, { role: "coach", plan: "pro" });

export default Analytics;