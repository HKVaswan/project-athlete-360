// src/integrations/aiProviderManager.ts
/**
 * AI Provider Manager
 * -------------------
 * - Pluggable provider adapters (each provider implements `AIProvider`).
 * - Weighted provider selection and failover strategy.
 * - Retries with exponential backoff.
 * - Circuit breaker per-provider (simple failure-count based).
 * - Timeout handling and metrics hooks.
 *
 * Design goals:
 * - Keep provider-specific code in small adapters (openrouter/gemini/ollama/etc).
 * - Manager handles orchestration, retries, and telemetry.
 *
 * NOTE: This file uses global fetch (Node 18+ / Node 20+). If you prefer axios,
 * install it and replace fetch calls in provider adapters.
 */

import { integrationConfig } from "./integrationConfig";
import logger from "../logger";

export type AIRequest = {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  // provider-specific hints
  [key: string]: any;
};

export type AIResponse = {
  success: boolean;
  provider: string;
  data?: any;
  error?: string;
  latencyMs?: number;
  meta?: any;
};

export interface AIProvider {
  id: string;
  weight?: number; // selection weight for load distribution
  healthy?: boolean;
  init?: () => Promise<void> | void;
  generate: (req: AIRequest, opts?: { timeoutMs?: number }) => Promise<AIResponse>;
  getHealth?: () => Promise<{ healthy: boolean; info?: any }>;
  shutdown?: () => Promise<void> | void;
}

/**
 * Simple circuit breaker per provider
 */
type CircuitState = {
  failures: number;
  lastFailureAt?: number | null;
  openUntil?: number | null;
};

const DEFAULT_OPTIONS = {
  timeoutMs: 20_000,
  maxRetries: 2,
  backoffBaseMs: 300,
  circuitFailureThreshold: 5,
  circuitOpenMs: 60_000, // 60s
};

/**
 * AiProviderManager class
 */
export class AiProviderManager {
  private providers: Map<string, AIProvider> = new Map();
  private circuit: Map<string, CircuitState> = new Map();

  constructor(private opts = DEFAULT_OPTIONS) {}

  /**
   * Register a provider adapter
   */
  registerProvider(provider: AIProvider) {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider with id='${provider.id}' already registered`);
    }
    this.providers.set(provider.id, provider);
    this.circuit.set(provider.id, { failures: 0, lastFailureAt: null, openUntil: null });
    provider.healthy = true;
    if (provider.init) {
      Promise.resolve(provider.init()).catch((e) =>
        logger.warn(`[AI] provider ${provider.id} init failed: ${e?.message || e}`)
      );
    }
    logger.info(`[AI] Registered provider: ${provider.id}`);
  }

  /**
   * Deregister provider (shutdown if available)
   */
  async deregisterProvider(id: string) {
    const p = this.providers.get(id);
    if (!p) return;
    try {
      if (p.shutdown) await p.shutdown();
    } catch (err) {
      logger.warn(`[AI] provider ${id} shutdown error: ${err?.message || err}`);
    }
    this.providers.delete(id);
    this.circuit.delete(id);
    logger.info(`[AI] Deregistered provider: ${id}`);
  }

  /**
   * Choose provider based on weight and circuit state
   */
  private chooseProvider(): AIProvider | null {
    const available: AIProvider[] = [];
    for (const p of this.providers.values()) {
      const state = this.circuit.get(p.id);
      // Check circuit open
      if (state && state.openUntil && Date.now() < state.openUntil) {
        // skip
        continue;
      }
      if (p.healthy !== false) available.push(p);
    }
    if (available.length === 0) return null;

    // weighted selection
    const totalWeight = available.reduce((s, p) => s + (p.weight ?? 1), 0);
    let pick = Math.random() * totalWeight;
    for (const p of available) {
      pick -= p.weight ?? 1;
      if (pick <= 0) return p;
    }
    return available[0];
  }

  /**
   * Report provider failure to circuit breaker
   */
  private recordFailure(providerId: string) {
    const state = this.circuit.get(providerId);
    if (!state) return;
    state.failures = (state.failures || 0) + 1;
    state.lastFailureAt = Date.now();
    if (state.failures >= (this.opts as any).circuitFailureThreshold) {
      state.openUntil = Date.now() + (this.opts as any).circuitOpenMs;
      logger.warn(`[AI] Circuit opened for provider ${providerId} until ${new Date(state.openUntil).toISOString()}`);
    }
  }

  /**
   * Report provider success (reset some failure counters)
   */
  private recordSuccess(providerId: string) {
    const state = this.circuit.get(providerId);
    if (!state) return;
    state.failures = 0;
    state.openUntil = null;
    state.lastFailureAt = null;
  }

  /**
   * Public generate method — orchestrates attempts, failover and retries
   */
  public async generate(req: AIRequest, opts?: Partial<typeof DEFAULT_OPTIONS>): Promise<AIResponse> {
    const options = { ...DEFAULT_OPTIONS, ...(opts || {}) };
    const triedProviders = new Set<string>();
    let lastError: any = null;

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      const provider = this.chooseProvider();
      if (!provider) {
        const errorMsg = "No healthy AI providers available";
        logger.error(`[AI] ${errorMsg}`);
        return { success: false, provider: "none", error: errorMsg };
      }
      // Avoid trying same provider repeatedly in immediate loop
      if (triedProviders.has(provider.id) && triedProviders.size < this.providers.size) {
        // pick another
        const alt = Array.from(this.providers.values()).find((p) => !triedProviders.has(p.id) && (this.circuit.get(p.id)?.openUntil ?? 0) < Date.now());
        if (alt) {
          // use alt
        }
      }

      triedProviders.add(provider.id);

      // Check provider circuit state (may have been opened after selection)
      const circuit = this.circuit.get(provider.id);
      if (circuit && circuit.openUntil && Date.now() < circuit.openUntil) {
        // skip this provider and continue
        continue;
      }

      const start = Date.now();
      try {
        const timeoutMs = options.timeoutMs;
        const pRes = await this.callWithTimeout(provider, req, timeoutMs);
        const latency = Date.now() - start;

        if (pRes.success) {
          this.recordSuccess(provider.id);
          // add latency to response meta
          pRes.latencyMs = latency;
          return pRes;
        } else {
          // provider returned unsuccessful structured response
          this.recordFailure(provider.id);
          lastError = pRes.error || pRes.data || "provider returned unsuccessful response";
          logger.warn(`[AI] Provider ${provider.id} responded with success=false (${lastError})`);
        }
      } catch (err: any) {
        lastError = err;
        logger.warn(`[AI] Provider ${provider.id} call failed: ${err?.message || err}`);
        this.recordFailure(provider.id);
      }

      // exponential backoff between attempts
      const backoff = options.backoffBaseMs * Math.pow(2, attempt);
      await this.delay(backoff);
    }

    // If we get here, we've exhausted retries
    const errorMsg = lastError?.message || lastError || "AI providers failed after retries";
    logger.error(`[AI] generate failed: ${errorMsg}`);
    return { success: false, provider: "all", error: errorMsg };
  }

  /**
   * Calls provider.generate with timeout guard
   */
  private async callWithTimeout(provider: AIProvider, req: AIRequest, timeoutMs: number): Promise<AIResponse> {
    return new Promise<AIResponse>(async (resolve, reject) => {
      let finished = false;

      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        const msg = `Provider ${provider.id} timed out after ${timeoutMs}ms`;
        logger.warn(`[AI] ${msg}`);
        reject(new Error(msg));
      }, timeoutMs);

      try {
        const res = await provider.generate(req, { timeoutMs });
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(res);
      } catch (err) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  private delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Health check for all providers
   */
  public async healthCheck() {
    const results: Record<string, any> = {};
    for (const [id, p] of this.providers) {
      try {
        let h = { healthy: true };
        if (p.getHealth) {
          h = await p.getHealth();
        }
        results[id] = { healthy: !!h.healthy, info: h.info ?? null, circuit: this.circuit.get(id) };
      } catch (err) {
        results[id] = { healthy: false, error: err?.message || err, circuit: this.circuit.get(id) };
      }
    }
    return results;
  }
}

/**
 * Factory: create a preconfigured manager and register built-in adapters.
 * NOTE: provider adapters are kept separate. Here we only show registration pattern.
 */
export const createDefaultAiManager = () => {
  const m = new AiProviderManager();
  // Example registration (adapters must be implemented in separate files)
  // import { geminiProvider } from "./providers/gemini.provider";
  // import { openRouterProvider } from "./providers/openrouter.provider";
  // import { ollamaProvider } from "./providers/ollama.provider";
  //
  // m.registerProvider(geminiProvider);
  // m.registerProvider(openRouterProvider);
  // m.registerProvider(ollamaProvider);
  //
  // For now, inspect integrationConfig for available keys and adapters.
  return m;
};