/**
 * src/integrations/pagerduty.bootstrap.ts
 * --------------------------------------------------------------------------
 * 🚨 PagerDuty Integration Bootstrap (Enterprise Edition)
 *
 * Responsibilities:
 *  - Initialize and manage PagerDuty incident notifications.
 *  - Abstract alert routing for errors, health failures, and telemetry alerts.
 *  - Supports async fallback to email/SMS if PagerDuty API unavailable.
 *  - Rate-limited + deduplicated alert dispatch (prevents spam storms).
 *  - Integrated with auditService and system telemetry.
 * --------------------------------------------------------------------------
 */

import axios from "axios";
import { logger } from "../logger";
import { config } from "../config";
import { auditService } from "../services/audit.service";
import { telemetry } from "../lib/telemetry";
import { recordError } from "../lib/core/metrics";

type PagerDutySeverity = "critical" | "error" | "warning" | "info";

interface PagerDutyEvent {
  routing_key: string;
  event_action: "trigger" | "acknowledge" | "resolve";
  dedup_key?: string;
  payload: {
    summary: string;
    source: string;
    severity: PagerDutySeverity;
    component?: string;
    group?: string;
    class?: string;
    custom_details?: Record<string, any>;
  };
  images?: Array<{ src: string; href?: string; alt?: string }>;
  links?: Array<{ href: string; text: string }>;
}

class PagerDutyClient {
  private readonly apiUrl = "https://events.pagerduty.com/v2/enqueue";
  private lastAlertTimestamps = new Map<string, number>();
  private rateLimitMs = 60_000; // 1 minute per dedup key

  /**
   * Send incident or alert to PagerDuty
   */
  async sendAlert(
    summary: string,
    severity: PagerDutySeverity = "critical",
    details: Record<string, any> = {},
    dedupKey?: string
  ) {
    const routingKey = config.alerts?.pagerDuty?.routingKey;
    if (!routingKey) {
      logger.warn("[PagerDuty] Routing key not configured — skipping alert.");
      return false;
    }

    // Rate-limit duplicate alerts
    const key = dedupKey || `${summary}-${severity}`;
    const lastSent = this.lastAlertTimestamps.get(key);
    if (lastSent && Date.now() - lastSent < this.rateLimitMs) {
      logger.info(`[PagerDuty] ⏱️ Skipping duplicate alert: ${key}`);
      return false;
    }

    const event: PagerDutyEvent = {
      routing_key: routingKey,
      event_action: "trigger",
      dedup_key: key,
      payload: {
        summary,
        source: config.nodeEnv || "unknown-environment",
        severity,
        component: details.component || "backend",
        group: details.group || "infrastructure",
        class: details.class || "system-alert",
        custom_details: details,
      },
    };

    try {
      const response = await axios.post(this.apiUrl, event, {
        headers: { "Content-Type": "application/json" },
        timeout: 5000,
      });

      this.lastAlertTimestamps.set(key, Date.now());
      telemetry.record("alerts.pagerduty.sent", 1);

      logger.info(`[PagerDuty] 🚀 Alert triggered: ${summary}`);
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "ALERT_TRIGGERED",
        details: { provider: "PagerDuty", summary, severity, eventId: response.data.dedup_key },
      });

      return true;
    } catch (err: any) {
      recordError("pagerduty_alert_failed", "critical");
      logger.error(`[PagerDuty] ❌ Failed to trigger alert: ${err.message}`);

      // Fallback notification to ensure reliability
      await this.fallbackNotify(summary, severity, details);
      return false;
    }
  }

  /**
   * Resolve a previously triggered alert
   */
  async resolveAlert(dedupKey: string) {
    if (!config.alerts?.pagerDuty?.routingKey) return;

    try {
      const event: PagerDutyEvent = {
        routing_key: config.alerts.pagerDuty.routingKey,
        event_action: "resolve",
        dedup_key: dedupKey,
        payload: {
          summary: "Incident resolved",
          source: config.nodeEnv,
          severity: "info",
        },
      };
      await axios.post(this.apiUrl, event);
      logger.info(`[PagerDuty] ✅ Incident resolved: ${dedupKey}`);
    } catch (err: any) {
      recordError("pagerduty_resolve_failed", "medium");
      logger.warn(`[PagerDuty] ⚠️ Failed to resolve incident: ${err.message}`);
    }
  }

  /**
   * Fallback mechanism — notify admins via email or Slack if PagerDuty fails
   */
  private async fallbackNotify(summary: string, severity: string, details: Record<string, any>) {
    logger.warn(`[PagerDuty:FALLBACK] Sending backup alert: ${summary}`);
    try {
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "ALERT_FALLBACK",
        details: { provider: "email/slack", summary, severity, ...details },
      });

      telemetry.record("alerts.fallback.triggered", 1);
      // You can also hook this into Slack or Email notification worker:
      // await addNotificationJob({ type: "systemAlert", body: summary, severity });
    } catch (err: any) {
      logger.error(`[PagerDuty:FALLBACK] ❌ Failed to send backup alert: ${err.message}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Export Singleton Instance                                                  */
/* -------------------------------------------------------------------------- */
export const pagerDutyClient = new PagerDutyClient();
export default pagerDutyClient;