import logger from "../logger";
import { config } from "../config";

/**
 * AI Model Registry
 * ------------------------------------------------------------------
 * Enterprise-grade registry for managing available AI models.
 * 
 * Features:
 *  - Central model catalog (across all AI providers)
 *  - Version tracking & deprecation management
 *  - Dynamic model selection (based on use-case or tier)
 *  - Pluggable metadata (performance score, latency, reliability)
 *  - Safe fallbacks for unavailable models
 */

export interface AIModelMetadata {
  provider: string;
  modelId: string;
  version?: string;
  description?: string;
  tags?: string[];
  recommended?: boolean;
  maxTokens?: number;
  temperature?: number;
  reliabilityScore?: number; // calculated via monitoring/telemetry
  latencyAvgMs?: number;
  lastChecked?: number;
  active?: boolean;
}

export class AiModelRegistry {
  private models: Map<string, AIModelMetadata> = new Map();

  /**
   * Register or update a model entry
   */
  register(model: AIModelMetadata) {
    const key = this.getKey(model.provider, model.modelId);
    if (this.models.has(key)) {
      const existing = this.models.get(key)!;
      this.models.set(key, { ...existing, ...model });
      logger.info(`[AI Registry] Updated model: ${key}`);
    } else {
      this.models.set(key, { ...model, active: true });
      logger.info(`[AI Registry] Registered new model: ${key}`);
    }
  }

  /**
   * Retrieve a model by provider + modelId
   */
  get(provider: string, modelId: string): AIModelMetadata | undefined {
    return this.models.get(this.getKey(provider, modelId));
  }

  /**
   * Returns all active models
   */
  listActive(): AIModelMetadata[] {
    return Array.from(this.models.values()).filter((m) => m.active !== false);
  }

  /**
   * Get best model by tag (e.g., "performance", "feedback")
   */
  getBestByTag(tag: string): AIModelMetadata | undefined {
    const tagged = Array.from(this.models.values()).filter(
      (m) => m.active && m.tags?.includes(tag)
    );

    if (tagged.length === 0) return undefined;
    return tagged.sort(
      (a, b) => (b.reliabilityScore ?? 0) - (a.reliabilityScore ?? 0)
    )[0];
  }

  /**
   * Mark model inactive (for temporary removal or maintenance)
   */
  deactivate(provider: string, modelId: string) {
    const key = this.getKey(provider, modelId);
    const model = this.models.get(key);
    if (model) {
      model.active = false;
      this.models.set(key, model);
      logger.warn(`[AI Registry] Model deactivated: ${key}`);
    }
  }

  /**
   * Refresh health telemetry (e.g., after performance monitoring)
   */
  updateTelemetry(
    provider: string,
    modelId: string,
    updates: Partial<Pick<AIModelMetadata, "reliabilityScore" | "latencyAvgMs" | "lastChecked">>
  ) {
    const key = this.getKey(provider, modelId);
    const model = this.models.get(key);
    if (model) {
      this.models.set(key, { ...model, ...updates });
    }
  }

  /**
   * Get model catalog snapshot (for dashboard or admin API)
   */
  snapshot() {
    return Array.from(this.models.values()).map((m) => ({
      provider: m.provider,
      modelId: m.modelId,
      version: m.version,
      active: m.active,
      reliabilityScore: m.reliabilityScore ?? "N/A",
      latencyAvgMs: m.latencyAvgMs ?? "N/A",
      tags: m.tags ?? [],
    }));
  }

  /**
   * Utility: generate key
   */
  private getKey(provider: string, modelId: string) {
    return `${provider}::${modelId}`;
  }

  /**
   * Initialize registry with built-in models (based on config)
   */
  async bootstrapDefaults() {
    logger.info("[AI Registry] Bootstrapping default models...");

    // Example Gemini model
    if (config.geminiApiKey) {
      this.register({
        provider: "gemini",
        modelId: "gemini-pro",
        version: "1.0",
        description: "Google Gemini Pro general-purpose model",
        tags: ["general", "feedback", "recommendation"],
        recommended: true,
        reliabilityScore: 0.95,
        latencyAvgMs: 700,
      });
    }

    // Example OpenRouter model
    if (config.openRouterApiKey) {
      this.register({
        provider: "openrouter",
        modelId: "gpt-4-turbo",
        version: "1.0",
        description: "High-accuracy model for reasoning and dialogue",
        tags: ["reasoning", "conversation"],
        recommended: true,
        reliabilityScore: 0.9,
        latencyAvgMs: 900,
      });
    }

    // Example Local Fallback
    this.register({
      provider: "local",
      modelId: "echo-fallback",
      version: "0.1",
      description: "Simple echo-based fallback model for offline mode",
      tags: ["fallback", "safe"],
      recommended: false,
      reliabilityScore: 0.7,
      latencyAvgMs: 200,
    });

    logger.info("[AI Registry] Default models registered successfully.");
  }
}

/**
 * Singleton instance
 */
export const aiModelRegistry = new AiModelRegistry();
await aiModelRegistry.bootstrapDefaults();

export default aiModelRegistry;