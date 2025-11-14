// src/services/adminNotification.service.ts
import logger from "../logger";

class AdminNotificationService {
  async sendToAdmin(adminId: string, subject: string, body: string) {
    // Replace: integrate with email/SMS/Slack
    logger.info("[AdminNotification] sendToAdmin", { adminId, subject });
    return { ok: true };
  }

  async broadcast(subject: string, body: string) {
    logger.info("[AdminNotification] broadcast", { subject });
    return { ok: true };
  }
}

const adminNotificationService = new AdminNotificationService();
export default adminNotificationService;
export { adminNotificationService };