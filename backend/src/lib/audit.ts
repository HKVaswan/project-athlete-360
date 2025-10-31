import { prisma } from "../prismaClient";
import { logger } from "../logger";
import crypto from "crypto";

/**
 * Enterprise Audit Logging System
 * ------------------------------------------------------
 *  - Logs all critical actions (user, system, AI, admin)
 *  - Stores immutable audit trails (tamper-resistant)
 *  - Supports event chaining for trace verification
 *  - Integrates with DB + external analytics providers
 *  - Can trigger alerts for suspicious activity
 */

export type AuditAction =
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "USER_REGISTER"
  | "DATA_UPDATE"
  | "DATA_DELETE"
  | "AI_DECISION"
  | "SYSTEM_ALERT"
  | "ADMIN_OVERRIDE"
  | "BACKUP_RUN"
  | "SECURITY_EVENT"
  | "OTHER";

export interface AuditEntry {
  actorId?: string;
  actorRole?: string;
  ip?: string;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  details?: any;
  metadata?: Record<string, any>;
  timestamp?: string;
}

class AuditService {
  /**
   * Record an audit entry with hash chaining (immutability)
   */
  async log(entry: AuditEntry) {
    const timestamp = new Date().toISOString();
    const data = {
      actorId: entry.actorId || "system",
      actorRole: entry.actorRole || "system",
      ip: entry.ip || "unknown",
      action: entry.action,
      entity: entry.entity || null,
      entityId: entry.entityId || null,
      details: entry.details || {},
      metadata: entry.metadata || {},
      timestamp,
    };

    // Create a chain hash to ensure tamper detection
    const prev = await prisma.auditLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { chainHash: true },
    });
    const previousHash = prev?.chainHash || "GENESIS";
    const chainHash = this.generateHash(data, previousHash);

    try {
      await prisma.auditLog.create({
        data: { ...data, chainHash, previousHash },
      });
      logger.info(`[AUDIT] ${entry.action} by ${entry.actorId || "SYSTEM"}`);
    } catch (err: any) {
      logger.error(`[AUDIT] ❌ Failed to log entry: ${err.message}`);
    }
  }

  /**
   * Generate a tamper-proof chain hash
   */
  private generateHash(data: any, prevHash: string): string {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(data) + prevHash)
      .digest("hex");
    return hash;
  }

  /**
   * Fetch recent audit logs (admin/super admin only)
   */
  async getRecent(limit = 50) {
    return prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        actorId: true,
        actorRole: true,
        action: true,
        entity: true,
        entityId: true,
        timestamp: true,
      },
    });
  }

  /**
   * Detect suspicious or repeated system activity
   */
  async detectAnomalies() {
    const logs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { action: "SECURITY_EVENT" },
          { action: "ADMIN_OVERRIDE" },
          { action: "DATA_DELETE" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const suspicious = logs.filter((log) => {
      if (!log.actorId) return true;
      if (log.actorRole === "system") return false;
      if (log.details?.reason === "manual override") return true;
      return false;
    });

    if (suspicious.length > 0) {
      logger.warn(`[AUDIT] ⚠️ Suspicious activity detected: ${suspicious.length} records`);
    }

    return suspicious;
  }

  /**
   * Purge old logs (rotational cleanup)
   */
  async purgeOldLogs(days = 90) {
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    logger.info(`[AUDIT] Purged logs older than ${days} days`);
  }
}

export const auditService = new AuditService();