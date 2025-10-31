/**
 * src/services/audit.service.ts
 * ----------------------------------------------------------------------
 * Audit Service (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Unified interface for logging all critical system events
 *  - Stores immutable audit chains (tamper-resistant)
 *  - Integrates with database and analytics
 *  - Auto-detects suspicious or privileged actions
 *  - Supports AI-based anomaly detection (future-ready)
 * ----------------------------------------------------------------------
 */

import { prisma } from "../prismaClient";
import { logger } from "../logger";
import crypto from "crypto";

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
   🧱 Core Service
------------------------------------------------------------------------*/
class AuditService {
  /**
   * Record a single audit event in immutable chain
   */
  async log(params: RecordAuditParams): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const data = {
        actorId: params.actorId || "system",
        actorRole: params.actorRole || "system",
        ip: params.ip || "unknown",
        action: params.action,
        entity: params.entity || null,
        entityId: params.entityId || null,
        details: params.details || {},
        metadata: params.metadata || {},
        timestamp,
      };

      // Chain integrity
      const prev = await prisma.auditLog.findFirst({
        orderBy: { createdAt: "desc" },
        select: { chainHash: true },
      });
      const previousHash = prev?.chainHash || "GENESIS";
      const chainHash = this.createChainHash(data, previousHash);

      await prisma.auditLog.create({
        data: { ...data, chainHash, previousHash },
      });

      // Super Admin event visibility boost
      if (params.actorRole === "super_admin") {
        logger.info(
          `[AUDIT] 🛡️ Super Admin action logged: ${params.action} (${params.actorId})`
        );
      } else {
        logger.debug(`[AUDIT] Event logged: ${params.action} by ${params.actorId}`);
      }
    } catch (err: any) {
      logger.error(`[AUDIT] ❌ Failed to log audit entry: ${err.message}`);
    }
  }

  /**
   * Generate chain hash for immutability
   */
  private createChainHash(data: any, previousHash: string): string {
    const str = JSON.stringify(data) + previousHash;
    return crypto.createHash("sha256").update(str).digest("hex");
  }

  /* -----------------------------------------------------------------------
     🧠 Suspicious Activity Detection
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
      logger.warn(`[AUDIT] ⚠️ ${flagged.length} suspicious events detected`);
      await prisma.securityAlert.createMany({
        data: flagged.map((r) => ({
          type: "auditAnomaly",
          details: { ...r.details, id: r.id },
          createdAt: new Date(),
        })),
      });
    }
  }

  /* -----------------------------------------------------------------------
     🗃️  Retrieve Logs (Paginated / Filterable)
  ------------------------------------------------------------------------*/
  async getLogs({
    page = 1,
    limit = 25,
    filter,
  }: {
    page?: number;
    limit?: number;
    filter?: Partial<RecordAuditParams>;
  }) {
    const where: any = {};

    if (filter?.actorId) where.actorId = filter.actorId;
    if (filter?.actorRole) where.actorRole = filter.actorRole;
    if (filter?.action) where.action = filter.action;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          actorId: true,
          actorRole: true,
          ip: true,
          action: true,
          entity: true,
          entityId: true,
          timestamp: true,
          chainHash: true,
          previousHash: true,
          details: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      total,
      page,
      limit,
      results: logs,
    };
  }

  /* -----------------------------------------------------------------------
     🧹 Purge Old Logs (with Super Admin validation)
  ------------------------------------------------------------------------*/
  async purgeOld(days = 90, actor?: { id: string; role: string }) {
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    if (actor?.role !== "super_admin") {
      throw new Error("Only super admin can purge audit logs.");
    }

    const count = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });

    await this.log({
      actorId: actor.id,
      actorRole: "super_admin",
      action: "ADMIN_OVERRIDE",
      details: { purgedRecords: count.count, retentionDays: days },
    });

    logger.info(`[AUDIT] 🧹 Purged ${count.count} old audit records.`);
    return count.count;
  }

  /* -----------------------------------------------------------------------
     📈 System Summary for Dashboard
  ------------------------------------------------------------------------*/
  async getSummary() {
    const total = await prisma.auditLog.count();
    const recent = await prisma.auditLog.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, actorId: true, actorRole: true, action: true, timestamp: true },
    });

    const recentSuperAdmin = await prisma.auditLog.count({
      where: { actorRole: "super_admin" },
    });

    return {
      total,
      recent,
      recentSuperAdmin,
    };
  }

  /* -----------------------------------------------------------------------
     🚨 Record High-Severity Security Event
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
        severity: event.severity,
        message: event.message,
        metadata: event.metadata,
      },
    });

    if (event.severity === "high") {
      await prisma.securityAlert.create({
        data: {
          type: "criticalSecurityEvent",
          details: event,
        },
      });
      logger.warn(`[AUDIT] 🚨 High-severity security event: ${event.message}`);
    }
  }
}

/* -----------------------------------------------------------------------
   🚀 Export Singleton
------------------------------------------------------------------------*/
export const auditService = new AuditService();

/**
 * Helper for consistent audit logging across modules.
 */
export const recordAuditEvent = async (entry: RecordAuditParams) => {
  try {
    await auditService.log(entry);
  } catch (err: any) {
    logger.error(`[AUDIT] Failed to record event: ${err.message}`);
  }
};