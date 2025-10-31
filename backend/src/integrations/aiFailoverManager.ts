import logger from "../logger";
import { AiProviderManager, AIResponse, AIRequest } from "./aiProviderManager";

/**
 * AI Failover Manager
 * -----------------------------------------------------------
 * Enterprise-grade layer that wraps AiProviderManager to:
 *  - Perform automatic failover between providers
 *  - Detect persistent provider failures
 *  - Enforce cooldown and recovery strategy
 *  - Maintain provider health telemetry
 *  - Integrate with alert/monitoring subsystems (future)
 */

type ProviderStatus = {
  healthy: boolean;
  lastFailure?: number;
  failureCount: number;
  lastLatency?: number;
};

export class AiFailoverManager {
  private providerManager: AiProviderManager;
  private providerHealth: Map<string, ProviderStatus> = new Map();
  private lastProviderUsed?: string;

  constructor(providerManager: AiProviderManager) {
    this.providerManager = providerManager;
  }

  /**
   * Send a prompt to AI safely with automatic failover.
   * Tries current provider, retries on another if failure detected.
   */
  async generateWithFailover(req: AIRequest): Promise<AIResponse> {
    const providers = Array.from(this.providerManager["providers"].values());
    if (providers.length === 0) {
      logger.error("[AI Failover] No registered AI providers");
      return { success: false, provider: "none", error: "No AI providers registered" };
    }

    // Shuffle providers for even distribution
    const shuffled = providers.sort(() => Math.random() - 0.5);

    let lastError: any = null;
    for (const provider of shuffled) {
      const status = this.providerHealth.get(provider.id);
      const now = Date.now();

      // skip temporarily unhealthy provider
      if (status?.healthy === false && status.lastFailure && now - status.lastFailure < 60_000) {
        logger.debug(`[AI Failover] Skipping ${provider.id} (cooldown active)`);
        continue;
      }

      logger.info(`[AI Failover] Attempting with provider: ${provider.id}`);

      const start = Date.now();
      try {
        const res = await provider.generate(req, { timeoutMs: 20_000 });
        const latency = Date.now() - start;

        // success
        if (res.success) {
          this.recordSuccess(provider.id, latency);
          this.lastProviderUsed = provider.id;
          logger.info(`[AI Failover] ✅ ${provider.id} succeeded in ${latency}ms`);
          return res;
        }

        // failed but structured response
        lastError = res.error || "AI provider returned unsuccessful result";
        this.recordFailure(provider.id);
        logger.warn(`[AI Failover] ${provider.id} failed structurally: ${lastError}`);
      } catch (err: any) {
        lastError = err?.message || err;
        this.recordFailure(provider.id);
        logger.error(`[AI Failover] ${provider.id} error: ${lastError}`);
      }
    }

    // If all providers failed, log and return fallback
    logger.error(`[AI Failover] ❌ All providers failed. Last error: ${lastError}`);
    return {
      success: false,
      provider: "all",
      error: `All AI providers failed. ${lastError || ""}`,
    };
  }

  /**
   * Record provider success
   */
  private recordSuccess(id: string, latency: number) {
    const status = this.providerHealth.get(id) || { healthy: true, failureCount: 0 };
    status.healthy = true;
    status.failureCount = 0;
    status.lastFailure = undefined;
    status.lastLatency = latency;
    this.providerHealth.set(id, status);
  }

  /**
   * Record provider failure and possibly mark unhealthy
   */
  private recordFailure(id: string) {
    const status = this.providerHealth.get(id) || { healthy: true, failureCount: 0 };
    status.failureCount += 1;
    status.lastFailure = Date.now();
    if (status.failureCount >= 3) {
      status.healthy = false;
      logger.warn(`[AI Failover] 🚨 Provider ${id} marked unhealthy after ${status.failureCount} failures`);
    }
    this.providerHealth.set(id, status);
  }

  /**
   * Periodic recovery sweep — resets providers after cooldown
   */
  public async recoverProviders() {
    const now = Date.now();
    for (const [id, s] of this.providerHealth.entries()) {
      if (!s.healthy && s.lastFailure && now - s.lastFailure > 2 * 60_000) {
        s.healthy = true;
        s.failureCount = 0;
        logger.info(`[AI Failover] Provider ${id} recovered and re-enabled`);
      }
    }
  }

  /**
   * Returns live provider telemetry for dashboard / monitoring
   */
  public getStatusSnapshot() {
    const snapshot: Record<string, any> = {};
    for (const [id, s] of this.providerHealth.entries()) {
      snapshot[id] = {
        healthy: s.healthy,
        failures: s.failureCount,
        lastFailure: s.lastFailure,
        lastLatency: s.lastLatency,
      };
    }
    return snapshot;
  }

  /**
   * Manual reset for a specific provider
   */
  public resetProvider(id: string) {
    if (this.providerHealth.has(id)) {
      this.providerHealth.set(id, { healthy: true, failureCount: 0 });
      logger.info(`[AI Failover] Provider ${id} manually reset to healthy`);
    }
  }

  /**
   * Graceful shutdown for all providers
   */
  public async shutdown() {
    logger.info("[AI Failover] Initiating shutdown...");
    const providers = Array.from(this.providerManager["providers"].values());
    for (const p of providers) {
      try {
        if (p.shutdown) await p.shutdown();
      } catch (err: any) {
        logger.warn(`[AI Failover] Error shutting down provider ${p.id}: ${err.message}`);
      }
    }
    logger.info("[AI Failover] Shutdown complete.");
  }
}

/**
 * Singleton export — attach to your app globally
 */
import aiManager from "./ai.bootstrap";

export const aiFailoverManager = new AiFailoverManager(aiManager);

export default aiFailoverManager;