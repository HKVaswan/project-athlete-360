/**
 * src/services/audit.service.ts
 * ----------------------------------------------------------------------
 * 🛡️ Enterprise-Grade Audit Service v2
 *
 * Responsibilities:
 *  - Immutable audit log chain (tamper-resistant)
 *  - Asynchronous, fault-tolerant audit event queue
 *  - Chain verification for data integrity
 *  - Suspicious action detection & auto alert integration
 *  - Future-ready for AI-driven anomaly analysis
 * ----------------------------------------------------------------------
 */

import { prisma } from "../prismaClient";
import { logger } from "../logger";
import crypto from "crypto";
import { superAdminAlertsService } from "./superAdminAlerts.service";

/* -----------------------------------------------------------------------
   🧩 Types
------------------------------------------------------------------------*/
export type AuditEventAction =
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
  | "IMPERSONATION_REQUEST"
  | "SUPERADMIN_ACTION"
  | "OTHER";

export interface RecordAuditParams {
  actorId: string;
  actorRole: string;
  action: AuditEventAction;
  ip?: string;
  entity?: string;
  entityId?: string;
  details?: Record<string, any>;
  metadata?: Record<string, any>;
}

/* -----------------------------------------------------------------------
   ⚙️ Audit Service Implementation
------------------------------------------------------------------------*/
class AuditService {
  private queue: RecordAuditParams[] = [];
  private isFlushing = false;

  /**
   * 🚀 Queue audit logs for async persistence
   */
  async log(params: RecordAuditParams): Promise<void> {
    this.queue.push(params);
    void this.flushQueue(); // Fire and forget
  }

  /**
   * 🧱 Process audit log queue (non-blocking)
   */
  private async flushQueue(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;

    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) continue;

      try {
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
          createdAt: new Date(),
        };

        // 🔗 Compute chain integrity
        const prev = await prisma.auditLog.findFirst({
          orderBy: { createdAt: "desc" },
          select: { chainHash: true },
        });
        const previousHash = prev?.chainHash || "GENESIS";
        const chainHash = this.createChainHash(data, previousHash);

        await prisma.auditLog.create({
          data: { ...data, chainHash, previousHash },
        });

        // Log visibility by role
        if (entry.actorRole === "super_admin") {
          logger.info(`[AUDIT] 🧩 Super Admin event logged: ${entry.action}`);
        } else {
          logger.debug(`[AUDIT] Logged: ${entry.action} (${entry.actorRole})`);
        }
      } catch (err: any) {
        logger.error(`[AUDIT] ❌ Failed to flush log: ${err.message}`);
      }
    }

    this.isFlushing = false;
  }

  /**
   * 🔐 Chain hash creation for tamper resistance
   */
  private createChainHash(data: any, previousHash: string): string {
    const str = JSON.stringify(data) + previousHash;
    return crypto.createHash("sha256").update(str).digest("hex");
  }

  /* -----------------------------------------------------------------------
     🔎 Chain Verification (Run during startup or health check)
  ------------------------------------------------------------------------*/
  async verifyChainIntegrity(limit = 500): Promise<{ valid: boolean; brokenAt?: string }> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    let prevHash = "GENESIS";
    for (const log of logs) {
      const recalculated = this.createChainHash(log, log.previousHash || "GENESIS");
      if (recalculated !== log.chainHash) {
        await superAdminAlertsService.dispatchSuperAdminAlert({
          title: "Audit Chain Corruption Detected",
          message: `Audit log chain broken at ID: ${log.id}`,
          category: "security",
          severity: "critical",
          metadata: { logId: log.id },
        });
        logger.error(`[AUDIT] 🚨 Chain broken at log ${log.id}`);
        return { valid: false, brokenAt: log.id };
      }
      prevHash = log.chainHash;
    }

    logger.info("[AUDIT] ✅ Chain integrity verified.");
    return { valid: true };
  }

  /* -----------------------------------------------------------------------
     🧠 Suspicious or Privileged Action Detection
  ------------------------------------------------------------------------*/
  async detectSuspicious(): Promise<void> {
    const recent = await prisma.auditLog.findMany({
      where: {
        OR: [
          { action: "SECURITY_EVENT" },
          { action: "ADMIN_OVERRIDE" },
          { action: "SUPERADMIN_ACTION" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const flagged = recent.filter(
      (r) =>
        !r.actorId ||
        r.actorRole === "system" ||
        (r.details && r.details?.reason === "manual override")
    );

    if (flagged.length > 0) {
      await superAdminAlertsService.dispatchSuperAdminAlert({
        title: "Suspicious Admin Activity",
        message: `${flagged.length} potentially unsafe actions detected.`,
        category: "security",
        severity: "high",
        metadata: { flagged },
      });

      logger.warn(`[AUDIT] ⚠️ ${flagged.length} suspicious events flagged.`);
    }
  }

  /* -----------------------------------------------------------------------
     🧹 Secure Purge (SuperAdmin only)
  ------------------------------------------------------------------------*/
  async purgeOld(days = 90, actor?: { id: string; role: string }) {
    if (actor?.role !== "super_admin") {
      throw new Error("Only Super Admins may purge audit logs.");
    }

    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });

    await this.log({
      actorId: actor.id,
      actorRole: "super_admin",
      action: "ADMIN_OVERRIDE",
      details: { purgedRecords: result.count, retentionDays: days },
    });

    logger.info(`[AUDIT] 🧹 ${result.count} records purged by ${actor.id}.`);
    return result.count;
  }

  /* -----------------------------------------------------------------------
     📊 Summary for Dashboards
  ------------------------------------------------------------------------*/
  async getSummary() {
    const total = await prisma.auditLog.count();
    const last5 = await prisma.auditLog.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        actorRole: true,
        action: true,
        createdAt: true,
        chainHash: true,
      },
    });

    const totalSuperAdmin = await prisma.auditLog.count({
      where: { actorRole: "super_admin" },
    });

    return {
      total,
      recent: last5,
      totalSuperAdmin,
    };
  }

  /* -----------------------------------------------------------------------
     🚨 Record Security Event
  ------------------------------------------------------------------------*/
  async recordSecurityEvent(event: {
    actorId?: string;
    actorRole?: string;
    message: string;
    severity: "low" | "medium" | "high";
    metadata?: Record<string, any>;
  }) {
    await this.log({
      actorId: event.actorId || "system",
      actorRole: event.actorRole || "system",
      action: "SECURITY_EVENT",
      details: {
        message: event.message,
        severity: event.severity,
        metadata: event.metadata,
      },
    });

    if (event.severity === "high") {
      await superAdminAlertsService.dispatchSuperAdminAlert({
        title: "Critical Security Event",
        message: event.message,
        category: "security",
        severity: "critical",
        metadata: event.metadata,
      });
    }
  }
}

/* -----------------------------------------------------------------------
   🚀 Export Singleton + Helper
------------------------------------------------------------------------*/
export const auditService = new AuditService();

export const recordAuditEvent = async (entry: RecordAuditParams) => {
  try {
    await auditService.log(entry);
  } catch (err: any) {
    logger.error(`[AUDIT] Record failed: ${err.message}`);
  }
};