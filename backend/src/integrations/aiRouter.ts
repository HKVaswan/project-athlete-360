import { AiProviderManager } from "./aiProviderManager";
import { integrationConfig } from "./integrationConfig";
import logger from "../logger";

type AITaskType =
  | "text"
  | "summary"
  | "analysis"
  | "recommendation"
  | "coaching"
  | "insight"
  | "classification"
  | "custom";

interface RouteDecision {
  providerId: string;
  reason: string;
}

/**
 * AI Router
 * --------------------------------------------------
 * Responsible for:
 *  - Selecting appropriate AI provider dynamically
 *  - Handling task-type specialization
 *  - Managing provider fallback logic
 *  - Maintaining transparent routing logs
 *  - Ensuring free-tier prioritization
 */
export class AiRouter {
  constructor(private providerManager: AiProviderManager) {}

  /**
   * Decide which provider to use based on task and config
   */
  private decideProvider(taskType: AITaskType): RouteDecision {
    const cfg = integrationConfig.providers;

    // Priority: free-tier provider → specialized → fallback
    if (cfg.gemini?.enabled && this.isFreeTierPreferred(taskType)) {
      return { providerId: "gemini", reason: "free-tier + general-purpose" };
    }

    // Task-type specialization
    switch (taskType) {
      case "analysis":
      case "classification":
        if (cfg.huggingface?.enabled)
          return { providerId: "huggingface", reason: "structured analysis task" };
        break;

      case "coaching":
      case "recommendation":
        if (cfg.openrouter?.enabled)
          return { providerId: "openrouter", reason: "creative reasoning task" };
        break;

      case "insight":
      case "summary":
        if (cfg.mistral?.enabled)
          return { providerId: "mistral", reason: "insight summarization" };
        break;
    }

    // Default fallback
    const defaultProvider =
      cfg.openrouter?.enabled
        ? "openrouter"
        : cfg.gemini?.enabled
        ? "gemini"
        : cfg.huggingface?.enabled
        ? "huggingface"
        : "ollama";

    return { providerId: defaultProvider, reason: "fallback" };
  }

  /**
   * Core generate() — unified AI interface
   */
  public async generate(
    taskType: AITaskType,
    prompt: string,
    options: Record<string, any> = {}
  ) {
    const decision = this.decideProvider(taskType);
    logger.info(
      `[AI Router] Task '${taskType}' routed to '${decision.providerId}' (${decision.reason})`
    );

    try {
      const result = await this.providerManager.generate({
        prompt,
        taskType,
        ...options,
      });
      return result;
    } catch (err: any) {
      logger.error(`[AI Router] ${decision.providerId} failed: ${err.message}`);

      // Fallback to secondary provider if failure occurs
      const fallback = this.getFallback(decision.providerId);
      if (fallback) {
        logger.warn(`[AI Router] Falling back to ${fallback}`);
        return await this.providerManager.generate({
          prompt,
          taskType,
          ...options,
          provider: fallback,
        });
      }

      throw new Error(`All AI providers failed for task '${taskType}'`);
    }
  }

  /**
   * Free-tier preference logic
   */
  private isFreeTierPreferred(taskType: AITaskType): boolean {
    const freePreferredTasks: AITaskType[] = [
      "text",
      "summary",
      "recommendation",
    ];
    return freePreferredTasks.includes(taskType);
  }

  /**
   * Provider fallback sequence
   */
  private getFallback(providerId: string): string | null {
    const fallbackMap: Record<string, string> = {
      gemini: "huggingface",
      huggingface: "openrouter",
      openrouter: "ollama",
      ollama: "mistral",
    };
    return fallbackMap[providerId] || null;
  }
}

/**
 * Factory function — create router instance linked to provider manager
 */
export const createAiRouter = (providerManager: AiProviderManager) => {
  logger.info("[AI Router] Initialized global AI routing engine");
  return new AiRouter(providerManager);
};