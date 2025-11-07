/**
 * src/integrations/slackAlert.bootstrap.ts
 * --------------------------------------------------------------------------
 * 💬 Slack Alert Integration (Enterprise Grade)
 *
 * Responsibilities:
 *  - Send alerts, warnings, and notifications to Slack channels via webhook.
 *  - Automatically invoked as fallback from PagerDuty or Sentry.
 *  - Supports message formatting, color-coding, and thread grouping.
 *  - Integrates with auditService & telemetry for reliability tracking.
 *  - Graceful degradation (no app crash on Slack outage).
 * --------------------------------------------------------------------------
 */

import axios from "axios";
import { logger } from "../logger";
import { config } from "../config";
import { auditService } from "../services/audit.service";
import { telemetry } from "../lib/telemetry";
import { recordError } from "../lib/core/metrics";

type SlackSeverity = "info" | "warning" | "error" | "critical";

interface SlackAlertPayload {
  title: string;
  message: string;
  severity?: SlackSeverity;
  context?: Record<string, any>;
  threadTs?: string;
}

class SlackAlertClient {
  private webhookUrl: string | null = null;
  private rateLimitMs = 30_000; // 30 seconds per alert key
  private lastSent = new Map<string, number>();

  constructor() {
    this.webhookUrl = config.alerts?.slack?.webhookUrl || process.env.SLACK_ALERT_WEBHOOK || null;
    if (this.webhookUrl)
      logger.info("[SlackAlert] ✅ Webhook configured for alerts.");
    else
      logger.warn("[SlackAlert] ⚠️ No webhook URL configured — alerts will be skipped.");
  }

  /**
   * Send alert message to Slack
   */
  async send(payload: SlackAlertPayload): Promise<boolean> {
    if (!this.webhookUrl) {
      logger.warn("[SlackAlert] Webhook not set — cannot send message.");
      return false;
    }

    const key = `${payload.title}-${payload.severity}`;
    const now = Date.now();
    const last = this.lastSent.get(key);

    if (last && now - last < this.rateLimitMs) {
      logger.debug(`[SlackAlert] Skipping duplicate alert: ${key}`);
      return false;
    }

    const color = this.colorForSeverity(payload.severity);
    const text = `*${payload.title}*\n${payload.message}`;

    const slackBody = {
      attachments: [
        {
          color,
          mrkdwn_in: ["text", "fields"],
          title: `Project Athlete 360 - ${payload.severity?.toUpperCase() || "INFO"}`,
          text,
          fields: payload.context
            ? Object.entries(payload.context).map(([k, v]) => ({
                title: k,
                value: typeof v === "object" ? JSON.stringify(v) : String(v),
                short: true,
              }))
            : [],
          footer: `Environment: ${config.nodeEnv}`,
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      await axios.post(this.webhookUrl, slackBody, {
        headers: { "Content-Type": "application/json" },
        timeout: 5000,
      });

      this.lastSent.set(key, now);
      telemetry.record("alerts.slack.sent", 1);

      logger.info(`[SlackAlert] 💬 Alert sent to Slack: ${payload.title}`);

      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "ALERT_SLACK_SENT",
        details: {
          severity: payload.severity,
          title: payload.title,
          message: payload.message,
          context: payload.context,
        },
      });

      return true;
    } catch (err: any) {
      recordError("slack_alert_failed", "medium");
      logger.error(`[SlackAlert] ❌ Failed to send Slack alert: ${err.message}`);

      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "ALERT_SLACK_FAILURE",
        details: { error: err.message, title: payload.title },
      });

      return false;
    }
  }

  /**
   * Send ephemeral debug/test message
   */
  async testConnection(): Promise<void> {
    if (!this.webhookUrl) {
      logger.warn("[SlackAlert] Skipping test — webhook not configured.");
      return;
    }

    await this.send({
      title: "🧪 Slack Alert Test",
      message: "This is a test alert from Project Athlete 360 backend.",
      severity: "info",
      context: { time: new Date().toISOString(), env: config.nodeEnv },
    });
  }

  /**
   * Severity color mapping
   */
  private colorForSeverity(severity?: SlackSeverity): string {
    switch (severity) {
      case "critical":
        return "#ff0000";
      case "error":
        return "#ff4500";
      case "warning":
        return "#ffa500";
      case "info":
      default:
        return "#36a64f";
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Export Singleton                                                           */
/* -------------------------------------------------------------------------- */
export const slackAlertClient = new SlackAlertClient();
export default slackAlertClient;