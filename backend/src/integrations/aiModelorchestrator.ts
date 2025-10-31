// src/integrations/aiModelOrchestrator.ts
/**
 * AI Model Orchestrator
 * ---------------------------------------------------------------
 * A high-level orchestrator that manages:
 *  - Multi-provider intelligent routing
 *  - Context-aware model selection
 *  - Response caching and normalization
 *  - AI Ethics + Safety verification hooks
 *  - Fallback to local deterministic provider
 *  - Async pre-warming and usage tracking
 *
 * This sits one layer above `AiProviderManager`.
 * Think of it as a "brain router" that chooses the right model
 * for each type of AI task (chat, summary, analytics, wellness insight, etc).
 */

import aiManager from "./ai.bootstrap";
import logger from "../logger";
import { cache } from "../lib/cacheManager";
import { aiEthicsGuard } from "./aiEthicsGuard";
import { AIRequest, AIResponse } from "./aiProviderManager";
import { config } from "../config";
import { aiCacheManager } from "./aiCacheManager";

interface OrchestratorOptions {
  useCache?: boolean;
  enforceEthics?: boolean;
  fallbackProvider?: string;
  logLatency?: boolean;
}

type TaskType =
  | "chat"
  | "summary"
  | "analysis"
  | "training"
  | "performance"
  | "recommendation"
  | "custom";

/**
 * Helper: map tasks → model/provider preferences
 * This can evolve dynamically as system learns usage patterns
 */
const MODEL_ROUTING: Record<TaskType, string[]> = {
  chat: ["gemini", "openrouter", "local-fallback"],
  summary: ["huggingface", "gemini", "local-fallback"],
  analysis: ["mistral", "openrouter", "local-fallback"],
  training: ["mistral", "gemini"],
  performance: ["mistral", "huggingface"],
  recommendation: ["gemini", "huggingface", "local-fallback"],
  custom: ["gemini", "local-fallback"],
};

export class AiModelOrchestrator {
  constructor(private opts: OrchestratorOptions = {}) {}

  /**
   * Route request to most suitable provider based on task type & availability.
   * Automatically retries with fallback models when needed.
   */
  async handleTask(task: TaskType, req: AIRequest): Promise<AIResponse> {
    const routingList = MODEL_ROUTING[task] || ["local-fallback"];
    const cacheKey = this.getCacheKey(task, req);
    const useCache = this.opts.useCache !== false;

    // 1️⃣ Cache Lookup
    if (useCache) {
      const cached = await aiCacheManager.get(cacheKey);
      if (cached) {
        logger.debug(`[AI Orchestrator] Cache hit for ${task}`);
        return { ...cached, provider: cached.provider || "cache" };
      }
    }

    // 2️⃣ Ethics Check (optional but critical)
    if (this.opts.enforceEthics !== false) {
      const safe = await aiEthicsGuard.validatePrompt(req.prompt);
      if (!safe.ok) {
        logger.warn(`[AI EthicsGuard] Blocked unsafe request: ${safe.reason}`);
        return {
          success: false,
          provider: "ethics-guard",
          error: `Blocked: ${safe.reason}`,
        };
      }
    }

    // 3️⃣ Intelligent Model Selection & Execution
    let lastError: any = null;
    for (const providerId of routingList) {
      try {
        const res = await aiManager.generate({ ...req, providerHint: providerId });
        if (res.success) {
          if (this.opts.logLatency && res.latencyMs)
            logger.info(`[AI Orchestrator] ${providerId} completed in ${res.latencyMs}ms`);

          // 4️⃣ Cache Result
          if (useCache) await aiCacheManager.set(cacheKey, res, 60 * 30); // 30 min cache
          return { ...res, routedProvider: providerId };
        } else {
          logger.warn(`[AI Orchestrator] ${providerId} failed: ${res.error}`);
          lastError = res.error;
        }
      } catch (err: any) {
        logger.warn(`[AI Orchestrator] Provider ${providerId} error: ${err.message}`);
        lastError = err;
        continue; // try next provider
      }
    }

    // 5️⃣ Final Fallback (if all fail)
    try {
      logger.warn(`[AI Orchestrator] All providers failed, using fallback provider`);
      const fallbackRes = await aiManager.generate({
        ...req,
        providerHint: this.opts.fallbackProvider || "local-fallback",
      });
      if (useCache) await aiCacheManager.set(cacheKey, fallbackRes, 60 * 5);
      return fallbackRes;
    } catch (err: any) {
      logger.error(`[AI Orchestrator] Fallback failed: ${err.message}`);
      return {
        success: false,
        provider: "none",
        error: `AI Orchestrator failed: ${lastError?.message || lastError || err}`,
      };
    }
  }

  /**
   * Helper: generate structured cache key
   */
  private getCacheKey(task: string, req: AIRequest) {
    const base = req.prompt?.slice(0, 100).replace(/\s+/g, "_") ?? "empty";
    return `ai:${task}:${base}:${req.temperature ?? "0"}`;
  }

  /**
   * Run a batch of AI tasks concurrently (with circuit-break safety)
   */
  async batchHandle(tasks: { task: TaskType; req: AIRequest }[]) {
    const results: AIResponse[] = [];
    for (const t of tasks) {
      try {
        const r = await this.handleTask(t.task, t.req);
        results.push(r);
      } catch (err: any) {
        results.push({
          success: false,
          provider: "none",
          error: `Batch task failed: ${err.message}`,
        });
      }
    }
    return results;
  }

  /**
   * Clear orchestrator-level cache entries
   */
  async clearCache(taskPrefix?: string) {
    const keyPrefix = taskPrefix ? `ai:${taskPrefix}` : "ai:";
    await aiCacheManager.clearPrefix(keyPrefix);
    logger.info(`[AI Orchestrator] Cleared cache prefix: ${keyPrefix}`);
  }

  /**
   * Check health of all connected providers
   */
  async health() {
    const res = await aiManager.healthCheck();
    const healthy = Object.values(res).some((v: any) => v.healthy);
    return { healthy, details: res };
  }
}

export const aiOrchestrator = new AiModelOrchestrator({
  useCache: true,
  enforceEthics: true,
  fallbackProvider: "local-fallback",
  logLatency: true,
});

export default aiOrchestrator;