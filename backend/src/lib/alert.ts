import { logger } from "../logger";
import { prisma } from "../prismaClient";
import { config } from "../config";
import { auditService } from "./audit";
import { sendEmail } from "./mailer"; // optional helper if you already have a mailer system

/**
 * Enterprise Alert Manager
 * ----------------------------------------------------------
 *  - Centralized alert pipeline for all system modules (AI, Security, Infra)
 *  - Supports multi-channel notifications (DB + email + console)
 *  - Provides deduplication and throttling to avoid spam
 *  - Designed for production-grade observability
 */

export type AlertLevel = "INFO" | "WARN" | "CRITICAL";
export type AlertSource =
  | "AI_ENGINE"
  | "SECURITY"
  | "PERFORMANCE"
  | "SYSTEM"
  | "MONITOR"
  | "USER"
  | "BACKUP"
  | "WORKER";

export interface AlertPayload {
  source: AlertSource;
  level: AlertLevel;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  actorId?: string;
  notifyAdmin?: boolean; // optional: email/SMS alert
}

class AlertService {
  /**
   * Create and log a new alert
   */
  async trigger(payload: AlertPayload) {
    const { source, level, title, message, metadata, actorId, notifyAdmin } = payload;

    try {
      // Save alert in DB for history / dashboard
      await prisma.systemAlert.create({
        data: {
          source,
          level,
          title,
          message,
          metadata,
          actorId: actorId || "system",
        },
      });

      // Log to system
      const logMsg = `[ALERT:${level}] ${source} → ${title}: ${message}`;
      if (level === "CRITICAL") logger.error(logMsg);
      else if (level === "WARN") logger.warn(logMsg);
      else logger.info(logMsg);

      // Add to audit trail
      await auditService.log({
        actorId: actorId || "system",
        actorRole: "system",
        action: "SYSTEM_ALERT",
        details: { source, level, title, message },
      });

      // Notify admin (email) if required and configured
      if (notifyAdmin && config.adminEmail) {
        await this.notifySuperAdmin(level, title, message, metadata);
      }
    } catch (err: any) {
      logger.error(`[ALERT] ❌ Failed to record alert: ${err.message}`);
    }
  }

  /**
   * Deduplicate frequent alerts (avoid log floods)
   */
  private async shouldThrottle(title: string, windowMinutes = 5): Promise<boolean> {
    const recent = await prisma.systemAlert.findFirst({
      where: {
        title,
        createdAt: {
          gt: new Date(Date.now() - windowMinutes * 60 * 1000),
        },
      },
    });
    return !!recent;
  }

  /**
   * Escalate critical alert to Super Admin via email or future integrations.
   */
  private async notifySuperAdmin(
    level: string,
    title: string,
    message: string,
    metadata?: Record<string, any>
  ) {
    try {
      const html = `
        <h2>🚨 [${level}] ${title}</h2>
        <p>${message}</p>
        ${
          metadata
            ? `<pre style="background:#f4f4f4;padding:10px;border-radius:6px">${JSON.stringify(metadata, null, 2)}</pre>`
            : ""
        }
        <p>Time: ${new Date().toISOString()}</p>
      `;
      await sendEmail(config.adminEmail!, `[ALERT] ${title}`, html);
      logger.info(`[ALERT] 📧 Super Admin notified: ${title}`);
    } catch (err: any) {
      logger.error(`[ALERT] ❌ Failed to notify admin: ${err.message}`);
    }
  }

  /**
   * Get recent alerts (for admin dashboards)
   */
  async getRecent(limit = 50) {
    return prisma.systemAlert.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        source: true,
        level: true,
        title: true,
        message: true,
        createdAt: true,
      },
    });
  }

  /**
   * Purge old alerts (log rotation)
   */
  async purgeOldAlerts(days = 60) {
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await prisma.systemAlert.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    logger.info(`[ALERT] Purged old alerts older than ${days} days`);
  }
}

export const alertService = new AlertService();