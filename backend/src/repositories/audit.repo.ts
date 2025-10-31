/**
 * src/repositories/audit.repo.ts
 * --------------------------------------------------------------------------
 * 🧾 Audit Repository (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Persistent storage and retrieval of audit log entries.
 *  - Chain-hash verification for tamper detection.
 *  - Support for filtered queries and pagination.
 *  - Optional archival/export to S3 for compliance.
 *  - Robust error isolation and retry-safe operations.
 */

import { prisma } from "../prismaClient";
import { logger } from "../logger";
import crypto from "crypto";
import { Errors } from "../utils/errors";
import { uploadToS3 } from "../lib/s3";

export interface CreateAuditInput {
  actorId: string;
  actorRole: string;
  ip?: string;
  action: string;
  entity?: string;
  entityId?: string;
  details?: Record<string, any>;
  metadata?: Record<string, any>;
  timestamp?: string;
}

class AuditRepository {
  /* ------------------------------------------------------------------------
     🧱 Create New Audit Entry with Chain Hash
  ------------------------------------------------------------------------ */
  async create(entry: CreateAuditInput) {
    try {
      const timestamp = entry.timestamp || new Date().toISOString();

      // Fetch last log to continue the chain
      const prev = await prisma.auditLog.findFirst({
        orderBy: { createdAt: "desc" },
        select: { chainHash: true },
      });

      const previousHash = prev?.chainHash || "GENESIS";
      const chainHash = this.computeChainHash(entry, previousHash, timestamp);

      const saved = await prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          ip: entry.ip || "unknown",
          action: entry.action,
          entity: entry.entity || null,
          entityId: entry.entityId || null,
          details: entry.details || {},
          metadata: entry.metadata || {},
          timestamp,
          previousHash,
          chainHash,
        },
      });

      logger.debug(`[AUDIT_REPO] Logged ${entry.action} by ${entry.actorRole}`);
      return saved;
    } catch (err: any) {
      logger.error(`[AUDIT_REPO] Failed to create log: ${err.message}`);
      throw Errors.Server("Failed to create audit entry");
    }
  }

  /* ------------------------------------------------------------------------
     🧮 Compute Tamper-Proof Chain Hash
  ------------------------------------------------------------------------ */
  private computeChainHash(entry: any, prevHash: string, timestamp: string) {
    const serialized = JSON.stringify({
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      details: entry.details,
      metadata: entry.metadata,
      timestamp,
    });
    return crypto.createHash("sha256").update(serialized + prevHash).digest("hex");
  }

  /* ------------------------------------------------------------------------
     📜 Retrieve Logs (Paginated + Filtered)
  ------------------------------------------------------------------------ */
  async findAll({
    page = 1,
    limit = 50,
    actorId,
    action,
    role,
    from,
    to,
  }: {
    page?: number;
    limit?: number;
    actorId?: string;
    action?: string;
    role?: string;
    from?: Date;
    to?: Date;
  }) {
    try {
      const where: any = {};
      if (actorId) where.actorId = actorId;
      if (action) where.action = action;
      if (role) where.actorRole = role;
      if (from || to)
        where.createdAt = {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        };

      const [total, records] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            actorId: true,
            actorRole: true,
            action: true,
            entity: true,
            entityId: true,
            timestamp: true,
            ip: true,
          },
        }),
      ]);

      return {
        total,
        page,
        limit,
        records,
      };
    } catch (err: any) {
      logger.error(`[AUDIT_REPO] Failed to fetch logs: ${err.message}`);
      throw Errors.Server("Failed to fetch audit logs");
    }
  }

  /* ------------------------------------------------------------------------
     🔍 Verify Chain Integrity
  ------------------------------------------------------------------------ */
  async verifyChainIntegrity(limit = 100): Promise<{ valid: boolean; brokenAt?: number }> {
    try {
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: "asc" },
        take: limit,
      });

      let prevHash = "GENESIS";
      for (const [index, log] of logs.entries()) {
        const expectedHash = this.computeChainHash(log, prevHash, log.timestamp);
        if (expectedHash !== log.chainHash) {
          logger.warn(`[AUDIT_REPO] ⚠️ Chain broken at entry ${log.id}`);
          return { valid: false, brokenAt: index };
        }
        prevHash = log.chainHash;
      }

      return { valid: true };
    } catch (err: any) {
      logger.error(`[AUDIT_REPO] Chain verification failed: ${err.message}`);
      throw Errors.Server("Chain integrity verification failed");
    }
  }

  /* ------------------------------------------------------------------------
     ☁️ Archive Logs to S3 (for Compliance)
  ------------------------------------------------------------------------ */
  async archiveToS3(days = 30) {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const logs = await prisma.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
      });

      if (logs.length === 0) {
        logger.info("[AUDIT_REPO] No old logs to archive.");
        return;
      }

      const content = JSON.stringify(logs, null, 2);
      const buffer = Buffer.from(content, "utf8");
      const fileKey = `audit-archives/audit-${cutoff.toISOString()}.json`;

      await uploadToS3({
        key: fileKey,
        body: buffer,
        contentType: "application/json",
      });

      logger.info(`[AUDIT_REPO] ☁️ Archived ${logs.length} logs to ${fileKey}`);

      await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });

      return { archivedCount: logs.length, fileKey };
    } catch (err: any) {
      logger.error(`[AUDIT_REPO] Archive failed: ${err.message}`);
      throw Errors.Server("Failed to archive audit logs");
    }
  }

  /* ------------------------------------------------------------------------
     🧩 Find Suspicious or Critical Events
  ------------------------------------------------------------------------ */
  async findSuspicious(limit = 50) {
    try {
      const logs = await prisma.auditLog.findMany({
        where: {
          OR: [
            { action: "ADMIN_OVERRIDE" },
            { action: "SECURITY_EVENT" },
            { action: "BACKUP_RUN" },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return logs;
    } catch (err: any) {
      logger.error(`[AUDIT_REPO] Failed to fetch suspicious logs: ${err.message}`);
      throw Errors.Server("Failed to fetch suspicious logs");
    }
  }
}

export const auditRepository = new AuditRepository();