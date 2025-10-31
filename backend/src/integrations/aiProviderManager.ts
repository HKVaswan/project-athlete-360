// src/integrations/aiProviderManager.ts
/**
 * Enterprise AI Provider Manager
 * - Weighted provider selection & failover
 * - Circuit breaker per-provider
 * - Concurrency limiting per-provider
 * - Timeout + retries + exponential backoff + jitter
 * - Telemetry hooks (metrics) and structured logging
 * - Prompt policy enforcement / sanitizer (prevent prompt-injection/unbounded requests)
 * - Adaptive logging of failed prompts for future retraining (aiSelfLearning worker)
 * - Local fallback provider support
 *
 * Usage:
 *  const manager = createDefaultAiManager({ metrics, policy });
 *  manager.registerProvider(openRouterProvider);
 *  const res = await manager.generate({ prompt: "..." });
 */

import logger from "../logger";
import { config } from "../config";

/* Optional metrics interface (pluggable) */
export interface MetricsAdapter {
  increment?: (name: string, value?: number, tags?: Record<string, any>) => void;
  timing?: (name: string, ms: number, tags?: Record<string, any>) => void;
  gauge?: (name: string, value: number, tags?: Record<string, any>) => void;
}

/* Basic AI request/response types */
export type AIRequest = {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  [k: string]: any;
};

export type AIResponse = {
  success: boolean;
  provider: string;
  data?: any;
  error?: string;
  latencyMs?: number;
  meta?: any;
};

/* Provider contract */
export interface AIProvider {
  id: string;
  weight?: number;
  healthy?: boolean;
  concurrencyLimit?: number; // optional: max concurrent requests
  init?: () => Promise<void> | void;
  shutdown?: () => Promise<void> | void;
  generate: (req: AIRequest, opts?: { timeoutMs?: number }) => Promise<AIResponse>;
  getHealth?: () => Promise<{ healthy: boolean; info?: any }>;
}

/* Options and defaults */
const DEFAULT_OPTIONS = {
  timeoutMs: 20_000,
  maxRetries: 2,
  backoffBaseMs: 300,
  backoffJitterMs: 100,
  circuitFailureThreshold: 5,
  circuitOpenMs: 60_000,
  perProviderConcurrencyDefault: 5,
  maskKeys: true,
  policyBlocklist: [
    // example banned tokens — customize
    /api_key/i,
    /password/i,
    /ssn/i,
  ] as (RegExp | string)[],
};

type CircuitState = {
  failures: number;
  lastFailureAt?: number | null;
  openUntil?: number | null;
};

/* Simple semaphore implementation (per-provider concurrency limiter) */
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    this.current = Math.max(0, this.current - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

/* Utility: mask secrets for logs */
const maskString = (s: string) => {
  if (!s || s.length < 6) return "****";
  return s.slice(0, 3) + "****" + s.slice(-3);
};

const maskKeysInObject = (obj: any) => {
  try {
    const copy = JSON.parse(JSON.stringify(obj));
    const mask = (val: any) =>
      typeof val === "string" ? (val.length > 10 ? maskString(val) : "****") : val;
    const recurse = (o: any) => {
      if (!o || typeof o !== "object") return;
      for (const k of Object.keys(o)) {
        if (/key|token|secret|password|api/i.test(k)) {
          o[k] = mask(o[k]);
        } else if (typeof o[k] === "object") {
          recurse(o[k]);
        }
      }
    };
    recurse(copy);
    return copy;
  } catch {
    return obj;
  }
};

/* Prompt policy enforcement - basic */
const violatesPolicy = (prompt: string, blocklist: (RegExp | string)[]) => {
  if (!prompt) return false;
  for (const rule of blocklist) {
    try {
      if (typeof rule === "string") {
        if (prompt.toLowerCase().includes(rule.toLowerCase())) return true;
      } else {
        if (rule.test(prompt)) return true;
      }
    } catch {
      // ignore bad rules
    }
  }
  return false;
};

/* AiManager class */
export class AiProviderManager {
  private providers = new Map<string, AIProvider>();
  private circuits = new Map<string, CircuitState>();
  private semaphores = new Map<string, Semaphore>();
  private opts: typeof DEFAULT_OPTIONS;
  private metrics?: MetricsAdapter;
  private adaptiveLogQueue: Array<{ req: AIRequest; providerId?: string; err?: any }> = [];

  constructor(options?: Partial<typeof DEFAULT_OPTIONS> & { metrics?: MetricsAdapter }) {
    this.opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    if (options?.metrics) this.metrics = options.metrics;
  }

  /* Register provider and initialize semaphores + circuit */
  registerProvider(provider: AIProvider) {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider '${provider.id}' already registered`);
    }
    this.providers.set(provider.id, provider);
    this.circuits.set(provider.id, { failures: 0, lastFailureAt: null, openUntil: null });

    const concurrency = provider.concurrencyLimit ?? this.opts.perProviderConcurrencyDefault;
    this.semaphores.set(provider.id, new Semaphore(concurrency));

    provider.healthy = true;
    if (provider.init) {
      Promise.resolve(provider.init()).catch((e) =>
        logger.warn(`[AI] provider ${provider.id} init failed: ${e?.message || e}`)
      );
    }
    logger.info(`[AI] Registered provider: ${provider.id} (concurrency=${concurrency})`);
  }

  async deregisterProvider(id: string) {
    const p = this.providers.get(id);
    if (!p) return;
    try {
      if (p.shutdown) await p.shutdown();
    } catch (err) {
      logger.warn(`[AI] provider ${id} shutdown error: ${err?.message || err}`);
    }
    this.providers.delete(id);
    this.circuits.delete(id);
    this.semaphores.delete(id);
    logger.info(`[AI] Deregistered provider: ${id}`);
  }

  /* Choose provider based on weight and circuit health */
  private chooseProvider(excludeIds = new Set<string>()): AIProvider | null {
    const now = Date.now();
    const candidates: AIProvider[] = [];
    for (const p of this.providers.values()) {
      if (excludeIds.has(p.id)) continue;
      const circuit = this.circuits.get(p.id);
      if (circuit?.openUntil && circuit.openUntil > now) continue; // skip open circuit
      if (p.healthy === false) continue;
      candidates.push(p);
    }
    if (candidates.length === 0) return null;
    const totalWeight = candidates.reduce((s, p) => s + (p.weight ?? 1), 0);
    let pick = Math.random() * totalWeight;
    for (const p of candidates) {
      pick -= p.weight ?? 1;
      if (pick <= 0) return p;
    }
    return candidates[0];
  }

  /* Circuit operations */
  private recordFailure(providerId: string) {
    const st = this.circuits.get(providerId);
    if (!st) return;
    st.failures = (st.failures || 0) + 1;
    st.lastFailureAt = Date.now();
    if (st.failures >= this.opts.circuitFailureThreshold) {
      st.openUntil = Date.now() + this.opts.circuitOpenMs;
      logger.warn(`[AI] Circuit opened for ${providerId} until ${new Date(st.openUntil).toISOString()}`);
      this.metrics?.increment?.("ai.provider.circuit_open", 1, { provider: providerId });
    }
  }

  private recordSuccess(providerId: string) {
    const st = this.circuits.get(providerId);
    if (!st) return;
    st.failures = 0;
    st.openUntil = null;
    st.lastFailureAt = null;
    this.metrics?.increment?.("ai.provider.success", 1, { provider: providerId });
  }

  /* Delay utility with jitter */
  private async delay(ms: number) {
    await new Promise((r) => setTimeout(r, ms + Math.floor(Math.random() * this.opts.backoffJitterMs)));
  }

  /* Call provider with timeout + concurrency limiting */
  private async callProviderWithGuards(provider: AIProvider, req: AIRequest, timeoutMs: number) {
    const sem = this.semaphores.get(provider.id);
    const release = sem ? await sem.acquire() : () => {};
    const start = Date.now();

    try {
      // Timeout guard
      const p = provider.generate(req, { timeoutMs });
      const timeoutPromise = new Promise<AIResponse>((_, rej) =>
        setTimeout(() => rej(new Error(`Provider ${provider.id} timed out after ${timeoutMs}ms`)), timeoutMs)
      );
      const res = await Promise.race([p, timeoutPromise]);
      const latency = Date.now() - start;
      if (res && typeof res === "object") (res as AIResponse).latencyMs = latency;
      this.metrics?.timing?.("ai.provider.latency_ms", latency, { provider: provider.id });
      return res as AIResponse;
    } finally {
      release();
    }
  }

  /**
   * Public: generate
   * - handles policy checks
   * - tries providers with retries + backoff
   * - uses local fallback if configured and external providers fail
   */
  public async generate(req: AIRequest, opts?: Partial<typeof DEFAULT_OPTIONS> & { localFallback?: AIProvider }) {
    const options = { ...this.opts, ...(opts || {}) };

    // Sanity/Policy checks
    if (violatesPolicy(req.prompt || "", options.policyBlocklist)) {
      logger.warn("[AI] Prompt blocked by policy");
      this.metrics?.increment?.("ai.prompt.blocked", 1);
      return { success: false, provider: "policy", error: "Prompt violates policy" } as AIResponse;
    }

    // Masked logging for safety
    const safeReq = options.maskKeys ? maskKeysInObject(req) : req;
    logger.debug(`[AI] generate called (masked)`, { req: safeReq });

    const tried = new Set<string>();
    let lastError: any = null;

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      const provider = this.chooseProvider(tried);
      if (!provider) break;

      tried.add(provider.id);

      const circuit = this.circuits.get(provider.id);
      if (circuit?.openUntil && circuit.openUntil > Date.now()) {
        logger.debug(`[AI] skipping ${provider.id} (circuit open)`);
        continue;
      }

      try {
        const start = Date.now();
        const res = await this.callProviderWithGuards(provider, req, options.timeoutMs);
        const latency = Date.now() - start;

        if (res && res.success) {
          this.recordSuccess(provider.id);
          this.metrics?.increment?.("ai.generate.success", 1, { provider: provider.id });
          return { ...res, provider: provider.id, latencyMs: latency } as AIResponse;
        } else {
          // provider responded but with success=false
          lastError = res?.error || "provider returned unsuccessful response";
          logger.warn(`[AI] provider ${provider.id} returned success=false: ${String(lastError)}`);
          this.recordFailure(provider.id);
          this.metrics?.increment?.("ai.generate.failure", 1, { provider: provider.id });
        }
      } catch (err: any) {
        lastError = err;
        logger.warn(`[AI] provider ${provider.id} call failed: ${err?.message || err}`);
        this.recordFailure(provider.id);
        this.metrics?.increment?.("ai.generate.error", 1, { provider: provider.id });
      }

      // backoff before retrying another provider
      const backoff = options.backoffBaseMs * Math.pow(2, attempt);
      await this.delay(backoff);
    }

    // If here, all providers exhausted or unavailable -> attempt local fallback if provided
    if (opts?.localFallback) {
      try {
        logger.info("[AI] attempting local fallback provider");
        const fallback = opts.localFallback;
        const res = await this.callProviderWithGuards(fallback, req, options.timeoutMs);
        if (res && res.success) {
          this.metrics?.increment?.("ai.fallback.success", 1, { provider: fallback.id });
          return { ...res, provider: fallback.id };
        } else {
          logger.warn("[AI] local fallback failed or returned success=false");
          this.metrics?.increment?.("ai.fallback.failure", 1, { provider: fallback.id });
        }
      } catch (err: any) {
        logger.error("[AI] local fallback provider error: " + (err?.message || err));
        this.metrics?.increment?.("ai.fallback.error", 1);
      }
    }

    // Adaptive logging of failed prompt for retraining (kept internal)
    try {
      this.adaptiveLogQueue.push({ req, err: lastError });
      // a worker (aiSelfLearning) should pick and process this queue (or flush to DB)
      if (this.adaptiveLogQueue.length > 1000) {
        // simple flush strategy — in production push to a durable queue
        this.adaptiveLogQueue.splice(0, this.adaptiveLogQueue.length - 100);
      }
    } catch (e) {
      // ensure no throw here
      logger.debug("[AI] adaptive log queue push failed", e);
    }

    const errMsg = lastError?.message || lastError || "No AI providers available";
    logger.error(`[AI] generate failed after retries: ${String(errMsg)}`);
    return { success: false, provider: "none", error: String(errMsg) } as AIResponse;
  }

  /* Health check across providers */
  public async healthCheck() {
    const out: Record<string, any> = {};
    for (const [id, p] of this.providers) {
      try {
        let info = { healthy: true };
        if (p.getHealth) info = await p.getHealth();
        out[id] = { healthy: !!info.healthy, info: info.info ?? null, circuit: this.circuits.get(id) };
      } catch (err: any) {
        out[id] = { healthy: false, error: err?.message || err, circuit: this.circuits.get(id) };
      }
    }
    return out;
  }

  /* Graceful shutdown of all providers */
  public async shutdown() {
    for (const [id, p] of this.providers) {
      try {
        if (p.shutdown) await p.shutdown();
      } catch (err: any) {
        logger.warn(`[AI] provider ${id} shutdown error: ${err?.message || err}`);
      }
    }
  }

  /* Expose adaptive log retrieval for background processing (aiSelfLearning worker) */
  public flushAdaptiveLogs(max = 1000) {
    const out = this.adaptiveLogQueue.splice(0, max);
    return out;
  }
}

/* Factory helper: create preconfigured manager */
export const createDefaultAiManager = (opts?: { metrics?: MetricsAdapter; policyBlocklist?: (RegExp | string)[] }) => {
  const manager = new AiProviderManager({ ...(opts || {}) as any });
  // Register adapters here, for example if you have provider modules:
  // import { openRouterProvider } from "./providers/openrouter.provider";
  // manager.registerProvider(openRouterProvider);
  // To keep file decoupled we do registration in an integration bootstrap file.
  return manager;
};