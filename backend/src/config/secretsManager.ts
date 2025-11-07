// src/config/secretsManager.ts
/**
 * src/config/secretsManager.ts (v4)
 * --------------------------------------------------------------------------
 * Enterprise Secrets Manager (v4) — Hardened & Observability-ready
 *
 * Features:
 *  - Pluggable backends: env | aws | vault
 *  - Encrypted in-memory cache (AES-256-GCM)
 *  - HMAC-signed fingerprints for tamper-resistant audit trails
 *  - Prometheus metric: pa360_secrets_access_total
 *  - Provider health checks + background refresh
 *  - Hot-reload API (reloadAll)
 *  - Integrated audit logging and graceful fallbacks
 * --------------------------------------------------------------------------
 */

import crypto from "crypto";
import fs from "fs";
import { logger } from "../logger";
import { config } from "./index";
import { auditService } from "../services/audit.service";
import { Counter } from "prom-client";

type Backend = "env" | "aws" | "vault";
type CacheEntry = {
  encryptedValue: string;
  fetchedAt: number;
  ttlMs: number;
  fingerprint: string;
  signature: string;
};

class SecretsManager {
  private backend: Backend;
  private cache = new Map<string, CacheEntry>();
  private defaultTTL = Number(config.secrets?.defaultTtlMs ?? 60_000); // 60s default
  private awsClient: any | null = null;
  private vaultClient: any | null = null;
  private initialized = false;
  private backgroundRefreshTimer: NodeJS.Timeout | null = null;

  // Prometheus metric
  private accessCounter = new Counter({
    name: "pa360_secrets_access_total",
    help: "Count of secrets accessed by backend and result",
    labelNames: ["backend", "result"],
  });

  constructor() {
    if (config.secrets?.backend === "vault") this.backend = "vault";
    else if (config.secrets?.backend === "aws") this.backend = "aws";
    else this.backend = "env";
  }

  /* ---------------------------------------------------------------------
   * Initialization — lazy and safe
   * ------------------------------------------------------------------ */
  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      if (this.backend === "aws" && config.secrets?.aws?.enabled) {
        const { SecretsManager } = require("@aws-sdk/client-secrets-manager");
        this.awsClient = new SecretsManager({ region: config.secrets.aws.region });
        logger.info("[SecretsManager] AWS backend initialized.");
      } else if (this.backend === "vault" && config.secrets?.vault?.enabled) {
        const Vault = require("node-vault");
        this.vaultClient = Vault({
          apiVersion: "v1",
          endpoint: config.secrets.vault.endpoint,
          token: config.secrets.vault.token,
        });
        logger.info("[SecretsManager] Vault backend initialized.");
      } else {
        logger.info("[SecretsManager] Using environment backend.");
      }
    } catch (err: any) {
      logger.error(`[SecretsManager] init failed: ${err?.message || err}`);
      // fallback to env backend
      this.backend = "env";
    }
    this.initialized = true;
    this.scheduleBackgroundRefresh();
  }

  /* ---------------------------------------------------------------------
   * Background refresh loop (non-blocking)
   * ------------------------------------------------------------------ */
  private scheduleBackgroundRefresh() {
    if (this.backgroundRefreshTimer) clearInterval(this.backgroundRefreshTimer);
    const interval = Number(config.secrets?.refreshIntervalMs ?? this.defaultTTL * 2);
    this.backgroundRefreshTimer = setInterval(() => {
      for (const key of this.cache.keys()) {
        void this.refresh(key).catch((e) =>
          logger.warn(`[SecretsManager] refresh failed for ${key}: ${e?.message || e}`)
        );
      }
    }, interval);
    this.backgroundRefreshTimer.unref();
  }

  /* ---------------------------------------------------------------------
   * Public: get secret (cached, encrypted)
   * ------------------------------------------------------------------ */
  async get(key: string, opts?: { forceRefresh?: boolean; ttlMs?: number }): Promise<string | null> {
    await this.init();

    const ttlMs = opts?.ttlMs ?? this.defaultTTL;
    const cached = this.cache.get(key);

    // Return from cache if valid
    if (cached && !opts?.forceRefresh && Date.now() - cached.fetchedAt < cached.ttlMs) {
      try {
        const value = this.decrypt(cached.encryptedValue);
        this.accessCounter.labels(this.backend, "cache_hit").inc();
        return value;
      } catch (err: any) {
        logger.warn(`[SecretsManager] decrypt failed for cached key ${key}: ${err?.message || err}`);
        // fall through to fetch fresh
      }
    }

    // Fetch from provider
    let value: string | null = null;
    try {
      if (this.backend === "aws") value = await this.fetchFromAws(key);
      else if (this.backend === "vault") value = await this.fetchFromVault(key);
      else value = await this.fetchFromEnv(key);
      this.accessCounter.labels(this.backend, value ? "success" : "not_found").inc();
    } catch (err: any) {
      logger.warn(`[SecretsManager] provider fetch failed (${key}): ${err?.message || err}`);
      // fallback to env if provider failed
      try {
        value = await this.fetchFromEnv(key);
        this.accessCounter.labels(this.backend, value ? "fallback_env_success" : "fallback_env_missing").inc();
      } catch (e) {
        this.accessCounter.labels(this.backend, "failure").inc();
      }
    }

    if (value != null) {
      const fingerprint = this.secretFingerprint(value);
      const signature = this.signFingerprint(fingerprint);
      const encryptedValue = this.encrypt(value);
      this.cache.set(key, {
        encryptedValue,
        fetchedAt: Date.now(),
        ttlMs,
        fingerprint,
        signature,
      });

      await this.recordAuditEvent("SECRET_READ", key, fingerprint, signature);
    }

    return value;
  }

  /* ---------------------------------------------------------------------
   * Put/rotate secret (writes to configured backend and updates cache)
   * ------------------------------------------------------------------ */
  async putSecret(key: string, value: string): Promise<void> {
    await this.init();
    const fingerprint = this.secretFingerprint(value);
    const signature = this.signFingerprint(fingerprint);

    try {
      if (this.backend === "aws" && this.awsClient) {
        const secretId = config.secrets.aws?.mapping?.[key] || key;
        // Note: SDK v3 client uses PutSecretValueCommand; using client convenience here for brevity
        await this.awsClient.putSecretValue?.({ SecretId: secretId, SecretString: value });
      } else if (this.backend === "vault" && this.vaultClient) {
        const path = config.secrets.vault?.mapping?.[key] || `secret/data/${key}`;
        await this.vaultClient.write(path, { data: { value } });
      } else {
        // Local fallback mirror (not secure; only for dev)
        fs.appendFileSync(".env.mirror", `\n# ${new Date().toISOString()} ${key}=${value}`);
      }

      // update cache
      const encryptedValue = this.encrypt(value);
      this.cache.set(key, { encryptedValue, fetchedAt: Date.now(), ttlMs: this.defaultTTL, fingerprint, signature });
      await this.recordAuditEvent("SECRET_ROTATED", key, fingerprint, signature);
      this.accessCounter.labels(this.backend, "put").inc();
    } catch (err: any) {
      logger.error(`[SecretsManager] putSecret failed for ${key}: ${err?.message || err}`);
      this.accessCounter.labels(this.backend, "put_failed").inc();
      throw err;
    }
  }

  /* ---------------------------------------------------------------------
   * Provider fetch implementations
   * ------------------------------------------------------------------ */
  private async fetchFromEnv(key: string): Promise<string | null> {
    return process.env[key] ?? null;
  }

  private async fetchFromAws(key: string): Promise<string | null> {
    if (!this.awsClient) return null;
    const secretId = config.secrets.aws?.mapping?.[key] || key;
    try {
      const resp = await this.awsClient.getSecretValue?.({ SecretId: secretId });
      if (!resp) return null;
      if (resp.SecretString) return resp.SecretString;
      if (resp.SecretBinary) return Buffer.from(resp.SecretBinary).toString("utf8");
      return null;
    } catch (err: any) {
      throw err;
    }
  }

  private async fetchFromVault(key: string): Promise<string | null> {
    if (!this.vaultClient) return null;
    const path = config.secrets.vault?.mapping?.[key] || `secret/data/${key}`;
    const resp = await this.vaultClient.read?.(path);
    // node-vault returns { data: { data: { <k>: <v> }}} depending on kv version; we assume 'value'
    return resp?.data?.data?.value ?? null;
  }

  /* ---------------------------------------------------------------------
   * Provider health check (helpful for dashboards)
   * ------------------------------------------------------------------ */
  async checkProviderHealth(): Promise<{ healthy: boolean; message: string }> {
    await this.init();
    try {
      if (this.backend === "aws" && this.awsClient) {
        // quick list/listSecrets with minimal permissions
        await this.awsClient.listSecrets?.({ MaxResults: 1 });
      } else if (this.backend === "vault" && this.vaultClient) {
        await this.vaultClient.health?.();
      } else {
        // env backend always considered healthy
      }
      return { healthy: true, message: "OK" };
    } catch (err: any) {
      logger.warn(`[SecretsManager] provider health check failed: ${err?.message || err}`);
      return { healthy: false, message: err?.message || "error" };
    }
  }

  /* ---------------------------------------------------------------------
   * Hot reload all cached secrets from provider
   * ------------------------------------------------------------------ */
  async reloadAll(): Promise<void> {
    const keys = Array.from(this.cache.keys());
    await Promise.all(keys.map((k) => this.refresh(k).catch((e) => logger.warn(`reloadAll ${k}: ${e?.message || e}`))));
    logger.info("[SecretsManager] 🔁 reloadAll completed");
  }

  /* ---------------------------------------------------------------------
   * Refresh single secret (force)
   * ------------------------------------------------------------------ */
  async refresh(key: string) {
    logger.debug(`[SecretsManager] Refreshing secret: ${key}`);
    return this.get(key, { forceRefresh: true });
  }

  /* ---------------------------------------------------------------------
   * Cache clear
   * ------------------------------------------------------------------ */
  clearCache() {
    this.cache.clear();
    logger.info("[SecretsManager] Cache cleared.");
  }

  /* ---------------------------------------------------------------------
   * Strength validation & asserts for critical secrets
   * ------------------------------------------------------------------ */
  async assertCriticalSecrets(required: string[]): Promise<boolean> {
    const missing: string[] = [];
    const weak: string[] = [];

    for (const key of required) {
      const val = await this.get(key);
      if (!val) {
        missing.push(key);
        continue;
      }
      if (this.isWeakSecret(val)) weak.push(key);
    }

    if (missing.length || weak.length) {
      const msg = `Missing or weak secrets detected. Missing: ${missing.join(",")} Weak: ${weak.join(",")}`;
      logger.error(`[SecretsManager] ${msg}`);
      await auditService.recordSecurityEvent?.({
        message: msg,
        severity: "high",
        metadata: { missing, weak },
      });
      throw new Error(msg);
    }

    logger.info("[SecretsManager] ✅ All required secrets validated.");
    return true;
  }

  /* ---------------------------------------------------------------------
   * Utilities: encryption, HMAC signing, fingerprinting, entropy
   * ------------------------------------------------------------------ */
  private getEncryptionKey(): Buffer {
    // Use provided encryption key from config, else derive from APP_SECRET fallback
    const raw = config.secrets?.encryptionKey || process.env.APP_SECRET || "local-dev-secret";
    return crypto.createHash("sha256").update(String(raw)).digest();
  }

  private encrypt(plain: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12); // recommended for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
      iv: iv.toString("base64"),
      data: encrypted.toString("base64"),
      tag: tag.toString("base64"),
    });
  }

  private decrypt(payload: string): string {
    try {
      const { iv, data, tag } = JSON.parse(payload);
      const key = this.getEncryptionKey();
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
      return decrypted;
    } catch (err: any) {
      logger.warn(`[SecretsManager] decrypt error: ${err?.message || err}`);
      throw err;
    }
  }

  secretFingerprint(secretValue: string) {
    return crypto.createHash("sha256").update(secretValue).digest("hex").slice(0, 32);
  }

  private signFingerprint(fingerprint: string) {
    const auditKey = config.secrets?.auditKey || process.env.SECRETS_AUDIT_KEY || "audit-default";
    return crypto.createHmac("sha256", String(auditKey)).update(fingerprint).digest("hex");
  }

  private isWeakSecret(value: string): boolean {
    if (!value) return true;
    if (value.length < 32) return true;
    const unique = new Set(value).size;
    return Math.log2(unique) < 3.5;
  }

  private estimateEntropy(value: string): number {
    const unique = new Set(value).size;
    return Math.log2(unique);
  }

  /* ---------------------------------------------------------------------
   * Audit & telemetry hook
   * ------------------------------------------------------------------ */
  private async recordAuditEvent(action: "SECRET_READ" | "SECRET_ROTATED", key: string, fingerprint: string, signature: string) {
    try {
      await auditService.log?.({
        actorId: "system",
        actorRole: "system",
        action,
        details: {
          key,
          fingerprint,
          signature,
          backend: this.backend,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.warn(`[SecretsManager] audit logging failed: ${err?.message || err}`);
    }
  }

  /* ---------------------------------------------------------------------
   * Debug helper (do not expose secrets in logs)
   * ------------------------------------------------------------------ */
  debugCacheSummary() {
    return {
      keys: Array.from(this.cache.keys()),
      count: this.cache.size,
      oldest: this.cache.size ? Math.min(...Array.from(this.cache.values()).map((v) => v.fetchedAt)) : null,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Export Singleton                                                           */
/* -------------------------------------------------------------------------- */
const secretsManager = new SecretsManager();
export default secretsManager;
export type { Backend };