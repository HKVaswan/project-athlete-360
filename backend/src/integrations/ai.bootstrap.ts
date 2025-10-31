// src/integrations/ai.bootstrap.ts
/**
 * AI Bootstrap
 * - Creates a single aiManager instance for the app
 * - Registers available provider adapters (only when configured)
 * - Exposes health / shutdown helpers
 *
 * Usage:
 *   import aiManager, { aiHealthCheck, aiShutdown } from "src/integrations/ai.bootstrap";
 */

import logger from "../logger";
import { config } from "../config";
import { createDefaultAiManager, AiProviderManager, AIProvider, AIRequest, AIResponse } from "./aiProviderManager";
import type { MetricsAdapter } from "./aiProviderManager";

/**
 * Optional: provide a metrics adapter implementation (Prometheus/Datadog)
 * Keep this decoupled so you can pass a real metrics adapter in prod.
 */
const metrics: MetricsAdapter = {
  increment: (name, v = 1, tags) => {
    // no-op by default — plug in Datadog/Prometheus/StatsD in production
    logger.debug(`[metrics] inc ${name} ${v}`, { tags });
  },
  timing: (name, ms, tags) => {
    logger.debug(`[metrics] timing ${name} ${ms}ms`, { tags });
  },
  gauge: (name, value, tags) => {
    logger.debug(`[metrics] gauge ${name} ${value}`, { tags });
  },
};

/**
 * Simple local fallback provider
 * Useful for dev or as a last-resort on-device fallback.
 * NOTE: This is intentionally simple — replace with a small LLM local adapter if desired.
 */
const localFallbackProvider: AIProvider = {
  id: "local-fallback",
  weight: 0.1,
  healthy: true,
  concurrencyLimit: 2,
  init: async () => {
    logger.info("[AI:local-fallback] initialized");
  },
  generate: async (req: AIRequest) => {
    // Extremely conservative deterministic fallback to avoid hallucinations
    const prompt = (req.prompt || "").trim().slice(0, 1500);
    const responseText = `Local fallback: no external AI configured. Echoing prompt summary (truncated): ${prompt.slice(
      0,
      300
    )}`;
    return {
      success: true,
      provider: "local-fallback",
      data: { text: responseText },
    } as AIResponse;
  },
  getHealth: async () => ({ healthy: true }),
  shutdown: async () => {
    logger.info("[AI:local-fallback] shutdown");
  },
};

/**
 * Factory to create and register real providers
 * Implement provider adapters in src/integrations/providers/*.ts
 * Each adapter must implement AIProvider
 */
async function registerConfiguredProviders(manager: AiProviderManager) {
  // Example: OpenRouter adapter (file: ./providers/openrouter.provider.ts)
  if (config.openRouterApiKey) {
    try {
      // dynamic import so app won't fail if adapter file missing
      // adapter must export named `openRouterProvider`
      // NOTE: adapter code must NOT throw on import in dev
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { openRouterProvider } = await import("./providers/openrouter.provider");
      manager.registerProvider(openRouterProvider);
      logger.info("[AI Bootstrap] Registered OpenRouter provider");
    } catch (err: any) {
      logger.warn("[AI Bootstrap] OpenRouter provider not registered:", err?.message || err);
    }
  } else {
    logger.debug("[AI Bootstrap] OPENROUTER not configured — skipping");
  }

  // Example: Gemini (google) adapter
  if (config.geminiApiKey) {
    try {
      const { geminiProvider } = await import("./providers/gemini.provider");
      manager.registerProvider(geminiProvider);
      logger.info("[AI Bootstrap] Registered Gemini provider");
    } catch (err: any) {
      logger.warn("[AI Bootstrap] Gemini provider not registered:", err?.message || err);
    }
  } else {
    logger.debug("[AI Bootstrap] GEMINI not configured — skipping");
  }

  // Example: Ollama (self-hosted) adapter
  if (config.ollamaUrl) {
    try {
      const { ollamaProvider } = await import("./providers/ollama.provider");
      manager.registerProvider(ollamaProvider);
      logger.info("[AI Bootstrap] Registered Ollama provider");
    } catch (err: any) {
      logger.warn("[AI Bootstrap] Ollama provider not registered:", err?.message || err);
    }
  } else {
    logger.debug("[AI Bootstrap] OLLAMA not configured — skipping");
  }

  // Add additional providers here following same pattern...
}

/**
 * Create global singleton manager
 */
const aiManager = createDefaultAiManager({
  metrics,
  policyBlocklist: config.aiPolicyBlocklist ?? undefined,
}) as AiProviderManager;

/**
 * Bootstrap registration and fallback wiring
 * - Register configured providers
 * - Always register local fallback (but with low weight) as last resort
 */
(async () => {
  try {
    logger.info("[AI Bootstrap] Starting AI manager bootstrap");
    await registerConfiguredProviders(aiManager);
    // Always register local fallback last if not present
    if (!aiManager["providers"] || !aiManager["providers"].has(localFallbackProvider.id)) {
      aiManager.registerProvider(localFallbackProvider);
      logger.info("[AI Bootstrap] Local fallback provider registered");
    }
    logger.info("[AI Bootstrap] AI manager bootstrap complete");
  } catch (err: any) {
    logger.error("[AI Bootstrap] Bootstrap failed:", err?.message || err);
  }
})();

/**
 * Helper: health check for controllers/workers
 */
export const aiHealthCheck = async () => {
  try {
    const res = await aiManager.healthCheck();
    return res;
  } catch (err: any) {
    logger.error("[AI Bootstrap] health check failed:", err?.message || err);
    return { ok: false, error: err?.message || err };
  }
};

/**
 * Helper: graceful shutdown
 */
export const aiShutdown = async () => {
  try {
    logger.info("[AI Bootstrap] shutting down AI manager...");
    await aiManager.shutdown();
    logger.info("[AI Bootstrap] AI manager shutdown complete");
  } catch (err: any) {
    logger.error("[AI Bootstrap] shutdown error:", err?.message || err);
  }
};

export default aiManager;