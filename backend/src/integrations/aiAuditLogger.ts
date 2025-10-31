// src/integrations/aiAuditLogger.ts
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { logger } from "../logger";
import { config } from "../config";
import crypto from "crypto";

interface AuditEntry {
  id?: string;
  timestamp: string;
  actor?: {
    id?: string;
    role?: string;
    ip?: string;
  };
  provider: string;
  prompt: string;
  response: string;
  latencyMs?: number;
  success: boolean;
  error?: string | null;
  meta?: Record<string, any>;
}

/**
 * AI Audit Logger
 * ------------------------------------------------------------------
 * - Records all AI interactions (prompt → response)
 * - Hashes sensitive content for privacy
 * - Supports DB (Postgres), file, and console logging fallback
 * - Ensures compliance with future audit & ethics policies
 */
export class AiAuditLogger {
  private static instance: AiAuditLogger;
  private db?: Pool;
  private logDir: string;

  private constructor() {
    this.logDir = path.join(process.cwd(), "logs", "ai-audit");
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Optional: setup Postgres connection if available
    if (config.databaseUrl) {
      try {
        this.db = new Pool({ connectionString: config.databaseUrl });
        logger.info("[AI Audit] PostgreSQL audit logging enabled");
      } catch (err) {
        logger.warn("[AI Audit] DB connection failed — fallback to file mode", err);
      }
    } else {
      logger.warn("[AI Audit] No DB connection — using file logs only");
    }
  }

  public static getInstance() {
    if (!this.instance) this.instance = new AiAuditLogger();
    return this.instance;
  }

  /**
   * Hash text for privacy before logging
   */
  private hash(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
  }

  /**
   * Record a structured audit log
   */
  public async record(entry: AuditEntry) {
    const record: AuditEntry = {
      id: entry.id ?? crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      actor: entry.actor ?? {},
      provider: entry.provider,
      prompt: this.hash(entry.prompt),
      response: this.hash(entry.response),
      latencyMs: entry.latencyMs,
      success: entry.success,
      error: entry.error || null,
      meta: entry.meta ?? {},
    };

    // Try DB logging first
    if (this.db) {
      try {
        await this.db.query(
          `INSERT INTO ai_audit_logs 
           (id, timestamp, actor_id, actor_role, actor_ip, provider, prompt_hash, response_hash, latency_ms, success, error, meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            record.id,
            record.timestamp,
            record.actor?.id ?? null,
            record.actor?.role ?? null,
            record.actor?.ip ?? null,
            record.provider,
            record.prompt,
            record.response,
            record.latencyMs ?? null,
            record.success,
            record.error,
            JSON.stringify(record.meta),
          ]
        );
        return;
      } catch (err: any) {
        logger.warn("[AI Audit] DB insert failed, writing to file", err.message);
      }
    }

    // Fallback → file
    const filePath = path.join(this.logDir, `${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");

    // Console fallback (last resort)
    if (!this.db) {
      logger.info(`[AI Audit] Log recorded (file mode): ${record.id}`);
    }
  }

  /**
   * Cleanup old audit logs (file-based)
   * Optional retention policy
   */
  public cleanupOldLogs(days = 30) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(this.logDir);

    for (const file of files) {
      const filePath = path.join(this.logDir, file);
      const stats = fs.statSync(filePath);
      if (stats.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        logger.info(`[AI Audit] Deleted old log file: ${file}`);
      }
    }
  }

  /**
   * Graceful shutdown
   */
  public async shutdown() {
    if (this.db) {
      await this.db.end().catch(() => {});
      logger.info("[AI Audit] DB connection closed");
    }
  }
}

// Export singleton instance
export const aiAuditLogger = AiAuditLogger.getInstance();