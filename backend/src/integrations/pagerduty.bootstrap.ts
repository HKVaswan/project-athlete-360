/**
 * src/integrations/pagerduty.bootstrap.ts
 * --------------------------------------------------------------------------
 * 🚨 PagerDuty Integration Bootstrap (Enterprise Edition)
 *
 * Responsibilities:
 *  - Initialize and manage PagerDuty incident notifications.
 *  - Abstract alert routing for errors, health failures, and telemetry alerts.
 *  - Supports async fallback to Slack/email if PagerDuty API unavailable.
 *  - Implements deduplication + rate-limiting (spam prevention).
 *  - Integrates with auditService, telemetry, and alert.worker.ts.
 *  - Securely handles sensitive data (via log_sanitizer).
 * --------------------------------------------------------------------------
 */

import axios from "axios";
import { logger } from "../logger";
import { config } from "../config";
import { auditService } from "../services/audit.service";
import { telemetry } from "../lib/telemetry";
import { recordError } from "../lib/core/metrics";
import { sanitizeForLog } from "../lib/log_sanitizer";

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
  private readonly rateLimitMs = 60_000; // 1 minute per dedup key

  /**
   * 🔔 Send incident or alert to PagerDuty
   */
  async trigger({
    title,
    message,
    severity = "critical",
    details = {},
    dedupKey,
    source = "system",
  }: {
    title: string;
    message: string;
    severity?: PagerDutySeverity;
    details?: Record<string, any>;
    dedupKey?: string;
    source?: string;
  }): Promise<boolean> {
    const routingKey = config.alerts?.pagerDuty?.routingKey;
    if (!routingKey) {
      logger.warn("[PagerDuty] Routing key not configured — skipping alert.");
      return false;
    }

    // Deduplication
    const key = dedupKey || `${title}-${severity}`;
    const lastSent = this.lastAlertTimestamps.get(key);
    if (lastSent && Date.now() - lastSent < this.rateLimitMs) {
      logger.debug(`[PagerDuty] ⏸️ Skipping duplicate alert: ${key}`);
      return false;
    }

    const payload = sanitizeForLog({
      summary: title,
      source: source || config.nodeEnv || "unknown",
      severity,
      component: details.component || "backend",
      group: details.group || "infrastructure",
      class: details.class || "system-alert",
      custom_details: { message, ...details },
    });

    const event: PagerDutyEvent = {
      routing_key: routingKey,
      event_action: "trigger",
      dedup_key: key,
      payload,
    };

    try {
      const response = await axios.post(this.apiUrl, event, {
        headers: { "Content-Type": "application/json" },
        timeout: 5000,
      });

      this.lastAlertTimestamps.set(key, Date.now());
      telemetry.record(`alerts.pagerduty.sent.${severity}`, 1);
      logger.info(`[PagerDuty] 🚀 Alert triggered: ${title} [${severity}]`);

      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "ALERT_TRIGGERED",
        details: { provider: "PagerDuty", summary: title, severity, eventId: response.data.dedup_key },
      });

      return true;
    } catch (err: any) {
      recordError("pagerduty_alert_failed", "critical");
      telemetry.record("alerts.pagerduty.failed", 1);
      logger.error(`[PagerDuty] ❌ Failed to trigger alert: ${err.message}`);

      // Fallback
      await this.fallbackNotify(title, severity, details);
      return false;
    }
  }

  /**
   * ✅ Resolve a previously triggered PagerDuty incident
   */
  async resolveAlert(dedupKey: string) {
    const routingKey = config.alerts?.pagerDuty?.routingKey;
    if (!routingKey) return;

    try {
      const event: PagerDutyEvent = {
        routing_key: routingKey,
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
   * 🛡️ Fallback Mechanism
   * Used when PagerDuty API fails — ensures alert still reaches admins.
   */
  private async fallbackNotify(summary: string, severity: string, details: Record<string, any>) {
    logger.warn(`[PagerDuty:FALLBACK] Sending backup alert: ${summary}`);

    try {
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "ALERT_FALLBACK",
        details: { provider: "email/slack", summary, severity, ...sanitizeForLog(details) },
      });

      telemetry.record("alerts.fallback.triggered", 1);

      // Optional Slack fallback if configured
      if (config.alerts?.slack?.webhookUrl) {
        const { slackAlertClient } = await import("./slackAlert.bootstrap");
        await slackAlertClient.send({
          title: `⚠️ [Fallback] ${summary}`,
          message: "PagerDuty delivery failed — fallback notification issued.",
          severity: "error",
          context: details,
        });
      }
    } catch (err: any) {
      logger.error(`[PagerDuty:FALLBACK] ❌ Fallback failed: ${err.message}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Export Singleton Instance                                                  */
/* -------------------------------------------------------------------------- */
export const pagerDutyClient = new PagerDutyClient();
export default pagerDutyClient;