import { prisma } from "../prismaClient";
import { logger } from "../logger";
import crypto from "crypto";
import { config } from "../config";
import { mask } from "./securityManager";
import { addNotificationJob } from "../workers/notification.worker";
import { ensureSuperAdmin } from "./securityManager";

/**
 * Enterprise Audit Logging System (v3)
 * -------------------------------------------------------------------------
 *  - Tamper-resistant chain hashing + HMAC signatures
 *  - Super admin restricted retrieval & purging
 *  - Auto-notification for security anomalies
 *  - Sanitized audit details (no PII leakage)
 *  - Integrity validation for every N records
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
   * Record an audit entry with dual-chain protection.
   */
  async log(entry: AuditEntry) {
    const timestamp = new Date().toISOString();

    // Sanitize details to avoid leaking PII or secrets
    const safeDetails = this.sanitize(entry.details || {});

    const data = {
      actorId: entry.actorId || "system",
      actorRole: entry.actorRole || "system",
      ip: entry.ip || "unknown",
      action: entry.action,
      entity: entry.entity || null,
      entityId: entry.entityId || null,
      details: safeDetails,
      metadata: entry.metadata || {},
      timestamp,
    };

    // Create chain hash
    const prev = await prisma.auditLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { chainHash: true },
    });
    const previousHash = prev?.chainHash || "GENESIS";
    const chainHash = this.generateHash(data, previousHash);
    const eventSignature = this.signEntry(chainHash);

    try {
      await prisma.auditLog.create({
        data: { ...data, chainHash, previousHash, eventSignature },
      });

      logger.info(`[AUDIT] ✅ ${entry.action} by ${entry.actorId || "SYSTEM"}`);
    } catch (err: any) {
      logger.error(`[AUDIT] ❌ Failed to log entry: ${err.message}`);

      // Fallback: persist to local log as emergency record
      logger.error(`[AUDIT:FALLBACK]`, JSON.stringify(data, null, 2));
    }
  }

  /**
   * Generate immutable chain hash.
   */
  private generateHash(data: any, prevHash: string): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(data) + prevHash)
      .digest("hex");
  }

  /**
   * Generate HMAC signature for authenticity validation.
   */
  private signEntry(chainHash: string): string {
    const key = config.auditSecret || process.env.AUDIT_SECRET || "audit-hmac-key";
    return crypto.createHmac("sha256", key).update(chainHash).digest("hex");
  }

  /**
   * Validate audit chain integrity.
   */
  async verifyIntegrity(limit = 100): Promise<{ valid: boolean; brokenAt?: string }> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    let prevHash = "GENESIS";
    for (const log of logs) {
      const expectedHash = this.generateHash(log, prevHash);
      if (expectedHash !== log.chainHash || !this.verifySignature(log.chainHash, log.eventSignature)) {
        logger.error(`[AUDIT] ⚠️ Integrity breach detected at log ID: ${log.id}`);
        await addNotificationJob({
          type: "criticalAlert",
          title: "Audit Integrity Violation",
          message: `Tampering suspected at log ID: ${log.id}`,
          severity: "high",
        });
        return { valid: false, brokenAt: log.id };
      }
      prevHash = log.chainHash;
    }
    logger.info("[AUDIT] ✅ Integrity verified for recent chain.");
    return { valid: true };
  }

  private verifySignature(chainHash: string, signature: string): boolean {
    const expected = this.signEntry(chainHash);
    return expected === signature;
  }

  /**
   * Fetch recent logs (super admin only)
   */
  async getRecent(limit = 50, role = "system") {
    ensureSuperAdmin(role);
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
   * Detect anomalies based on action patterns or chain inconsistencies
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
      logger.warn(`[AUDIT] ⚠️ Suspicious activity detected: ${suspicious.length} events`);
      await addNotificationJob({
        type: "securityAlert",
        title: "Suspicious Audit Activity",
        message: `${suspicious.length} suspicious actions detected.`,
        severity: "medium",
      });
    }

    return suspicious;
  }

  /**
   * Purge old logs securely (super admin only)
   */
  async purgeOldLogs(days = 90, role = "system") {
    ensureSuperAdmin(role);
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    logger.info(`[AUDIT] 🧹 Purged logs older than ${days} days`);
  }

  /**
   * Sanitize fields to prevent sensitive storage.
   */
  private sanitize(details: any) {
    const clean: Record<string, any> = {};
    for (const k of Object.keys(details || {})) {
      if (/password|token|secret|email|key/i.test(k)) {
        clean[k] = mask(details[k]);
      } else {
        clean[k] = details[k];
      }
    }
    return clean;
  }
}

export const auditService = new AuditService();