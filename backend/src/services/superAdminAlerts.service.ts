// src/services/superAdminAlerts.service.ts
import { prisma } from "../prismaClient";
import logger from "../logger";

export type SystemAlert = {
  title: string;
  message: string;
  severity?: "info" | "warn" | "critical";
  metadata?: Record<string, any>;
};

class SuperAdminAlertsService {
  async createSuperAdminAlert(alert: SystemAlert) {
    // Lightweight DB-backed alert (create a Payment-like record or special table later)
    try {
      // Keep it simple: write to AuditEntry for now
      const entry = await prisma.auditEntry.create({
        data: {
          actorId: null,
          action: "SUPER_ADMIN_ALERT",
          resource: alert.title,
          meta: { message: alert.message, severity: alert.severity, metadata: alert.metadata },
        },
      });
      logger.info("[SuperAdminAlerts] created", { id: entry.id, severity: alert.severity });
      return entry;
    } catch (err: any) {
      logger.error("[SuperAdminAlerts] create failed", { error: err.message });
      return undefined;
    }
  }

  async dispatchSuperAdminAlert(alert: SystemAlert) {
    // placeholder: send to external channels (email/Slack) later
    logger.warn("[SuperAdminAlerts] dispatch", alert);
    return this.createSuperAdminAlert(alert);
  }

  async sendSystemAlert(alert: SystemAlert) {
    // compatibility surface for workers that call sendSystemAlert
    return this.dispatchSuperAdminAlert(alert);
  }
}

export const superAdminAlertsService = new SuperAdminAlertsService();
export default superAdminAlertsService;