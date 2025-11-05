/**
 * src/config/secretsManager.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Secrets Manager (v3)
 *
 * Features:
 *  - Pluggable: ENV | AWS Secrets Manager | Vault
 *  - Secure in-memory cache with TTL + async refresh
 *  - Integrated audit logging & tamper-proof fingerprints
 *  - Self-healing fallback for temporary provider failures
 *  - Entropy-based secret strength validation
 *  - Compatible with automated key rotation worker
 * --------------------------------------------------------------------------
 */

import crypto from "crypto";
import fs from "fs";
import { logger } from "../logger";
import { config } from "./index";
import { auditService } from "../services/audit.service";

type Backend = "env" | "aws" | "vault";
type CacheEntry = { value: string; fetchedAt: number; ttlMs: number; fingerprint: string };

class SecretsManager {
  private backend: Backend;
  private cache = new Map<string, CacheEntry>();
  private defaultTTL = 60_000; // 60s
  private awsClient: any | null = null;
  private vaultClient: any | null = null;
  private initialized = false;
  private backgroundRefreshTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (config.secrets.backend === "vault") this.backend = "vault";
    else if (config.secrets.backend === "aws") this.backend = "aws";
    else this.backend = "env";
  }

  /* ---------------------------------------------------------------------
   * 🧩 Initialize Provider Clients (lazy)
   * ------------------------------------------------------------------ */
  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      if (this.backend === "aws" && config.secrets.aws?.enabled) {
        const { SecretsManager: AWSSecretsManager } = require("@aws-sdk/client-secrets-manager");
        this.awsClient = new AWSSecretsManager({ region: config.secrets.aws.region });
        logger.info("[SecretsManager] AWS backend initialized.");
      } else if (this.backend === "vault" && config.secrets.vault?.enabled) {
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
      logger.error(`[SecretsManager] init failed: ${err.message}`);
      this.backend = "env"; // fallback
    }
    this.initialized = true;

    // Background auto-refresh (non-blocking)
    this.scheduleBackgroundRefresh();
  }

  /* ---------------------------------------------------------------------
   * 🔁 Background refresh
   * ------------------------------------------------------------------ */
  private scheduleBackgroundRefresh() {
    if (this.backgroundRefreshTimer) clearInterval(this.backgroundRefreshTimer);
    this.backgroundRefreshTimer = setInterval(() => {
      for (const key of this.cache.keys()) {
        void this.refresh(key);
      }
    }, this.defaultTTL * 2);
  }

  /* ---------------------------------------------------------------------
   * 🔐 Get secret (cached)
   * ------------------------------------------------------------------ */
  async get(key: string, opts?: { forceRefresh?: boolean; ttlMs?: number }): Promise<string | null> {
    await this.init();

    const ttlMs = opts?.ttlMs ?? this.defaultTTL;
    const cached = this.cache.get(key);
    if (cached && !opts?.forceRefresh && Date.now() - cached.fetchedAt < cached.ttlMs) {
      return cached.value;
    }

    let value: string | null = null;
    try {
      value =
        this.backend === "aws"
          ? await this.fetchFromAws(key)
          : this.backend === "vault"
          ? await this.fetchFromVault(key)
          : await this.fetchFromEnv(key);
    } catch (err: any) {
      logger.warn(`[SecretsManager] Provider fetch failed (${key}): ${err.message}`);
      value = await this.fetchFromEnv(key); // fallback
    }

    if (value != null) {
      const fingerprint = this.secretFingerprint(value);
      this.cache.set(key, { value, fetchedAt: Date.now(), ttlMs, fingerprint });
      await this.recordAuditEvent("SECRET_READ", key, fingerprint);
    }

    return value;
  }

  /* ---------------------------------------------------------------------
   * 🧱 Provider fetchers
   * ------------------------------------------------------------------ */
  private async fetchFromEnv(key: string) {
    return process.env[key] ?? null;
  }

  private async fetchFromAws(key: string): Promise<string | null> {
    if (!this.awsClient) return null;
    const secretId = config.secrets.aws?.mapping?.[key] || key;
    const resp = await this.awsClient.getSecretValue({ SecretId: secretId });
    if (resp.SecretString) return resp.SecretString;
    if (resp.SecretBinary) return Buffer.from(resp.SecretBinary).toString("utf8");
    return null;
  }

  private async fetchFromVault(key: string): Promise<string | null> {
    if (!this.vaultClient) return null;
    const path = config.secrets.vault?.mapping?.[key] || `secret/data/${key}`;
    const resp = await this.vaultClient.read(path);
    return resp?.data?.data?.value ?? null;
  }

  /* ---------------------------------------------------------------------
   * 🧩 Write / Rotate Secret
   * ------------------------------------------------------------------ */
  async putSecret(key: string, value: string): Promise<void> {
    await this.init();
    const fingerprint = this.secretFingerprint(value);

    if (this.backend === "aws" && this.awsClient) {
      const secretId = config.secrets.aws?.mapping?.[key] || key;
      await this.awsClient.putSecretValue({ SecretId: secretId, SecretString: value });
    } else if (this.backend === "vault" && this.vaultClient) {
      const path = config.secrets.vault?.mapping?.[key] || `secret/data/${key}`;
      await this.vaultClient.write(path, { data: { value } });
    } else {
      fs.appendFileSync(".env.mirror", `\n${key}=${value}`);
    }

    this.cache.set(key, { value, fetchedAt: Date.now(), ttlMs: this.defaultTTL, fingerprint });
    await this.recordAuditEvent("SECRET_ROTATED", key, fingerprint);
  }

  /* ---------------------------------------------------------------------
   * 🚨 Validate Secrets Strength
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
      await auditService.recordSecurityEvent({
        message: msg,
        severity: "high",
        metadata: { missing, weak },
      });
      throw new Error(msg);
    }

    logger.info("[SecretsManager] ✅ All required secrets validated.");
    return true;
  }

  private isWeakSecret(value: string): boolean {
    if (value.length < 32) return true;
    const entropy = this.estimateEntropy(value);
    return entropy < 3.5; // bits per char
  }

  private estimateEntropy(value: string): number {
    const unique = new Set(value).size;
    return Math.log2(unique);
  }

  /* ---------------------------------------------------------------------
   * 🔍 Utility + Audit
   * ------------------------------------------------------------------ */
  secretFingerprint(secretValue: string) {
    return crypto.createHash("sha256").update(secretValue).digest("hex").slice(0, 16);
  }

  private async recordAuditEvent(action: "SECRET_READ" | "SECRET_ROTATED", key: string, fingerprint: string) {
    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "SECURITY_EVENT",
      details: { event: action, key, fingerprint },
    });
  }

  clearCache() {
    this.cache.clear();
    logger.info("[SecretsManager] Cache cleared.");
  }

  async refresh(key: string) {
    logger.debug(`[SecretsManager] Refreshing secret: ${key}`);
    return this.get(key, { forceRefresh: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Export Singleton                                                           */
/* -------------------------------------------------------------------------- */
const secretsManager = new SecretsManager();
export default secretsManager;
export type { Backend };