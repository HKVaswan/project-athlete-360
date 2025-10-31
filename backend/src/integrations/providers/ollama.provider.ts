// src/integrations/providers/ollama.provider.ts
import type { AIProvider, AIRequest, AIResponse } from "../aiProviderManager";
import { integrationConfig } from "../integrationConfig";
import logger from "../../logger";

/**
 * Ollama AI Provider Adapter
 * --------------------------------------------
 * - Fully local or LAN-hosted free AI backend.
 * - Supports models like Mistral, Phi-3, Llama 3.
 * - Zero external API dependency → complete privacy.
 * - Perfect for early-stage or budget-limited setups.
 */

const OLLAMA_BASE_URL = integrationConfig.ollamaBaseUrl || "http://127.0.0.1:11434";

export const ollamaProvider: AIProvider = {
  id: "ollama",
  weight: 2,

  init: async () => {
    logger.info("[AI:Ollama] Initializing provider...");
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      if (!res.ok) throw new Error(`Ollama not reachable (status ${res.status})`);
      logger.info("[AI:Ollama] Connected successfully ✅");
    } catch (err: any) {
      logger.error(`[AI:Ollama] Connection failed: ${err.message}`);
    }
  },

  generate: async (req: AIRequest): Promise<AIResponse> => {
    const start = Date.now();
    const model = req.model || "mistral"; // You can change this to any available Ollama model
    const prompt = req.prompt;

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: req.temperature ?? 0.7,
            num_predict: req.maxTokens ?? 512,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error(`[AI:Ollama] Error ${response.status}: ${text}`);
        return {
          success: false,
          provider: "ollama",
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const latency = Date.now() - start;

      return {
        success: true,
        provider: "ollama",
        data: data.response || data,
        latencyMs: latency,
      };
    } catch (err: any) {
      logger.error(`[AI:Ollama] Generation failed: ${err.message}`);
      return {
        success: false,
        provider: "ollama",
        error: err.message,
      };
    }
  },

  getHealth: async () => {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      return { healthy: res.ok, info: res.ok ? "Ollama ready" : `Status ${res.status}` };
    } catch (err: any) {
      return { healthy: false, info: err.message };
    }
  },
};