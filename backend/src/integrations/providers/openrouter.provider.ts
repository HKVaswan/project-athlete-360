// src/integrations/providers/openrouter.provider.ts
import type { AIProvider, AIRequest, AIResponse } from "../aiProviderManager";
import { integrationConfig } from "../integrationConfig";
import logger from "../../logger";

/**
 * OpenRouter Provider Adapter
 * -------------------------------------------------
 * - Cloud-based fallback AI provider
 * - Supports Mistral, Llama 3, Claude, Gemma, etc.
 * - Offers free-tier usage for testing/development
 * - Auto-switches if local Ollama fails
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = integrationConfig.openRouterKey || process.env.OPENROUTER_API_KEY || "";

export const openRouterProvider: AIProvider = {
  id: "openrouter",
  weight: 1, // lower priority than local Ollama

  init: async () => {
    if (!API_KEY) {
      logger.warn("[AI:OpenRouter] No API key found — skipping initialization.");
      return;
    }
    logger.info("[AI:OpenRouter] Provider initialized successfully ✅");
  },

  generate: async (req: AIRequest): Promise<AIResponse> => {
    const start = Date.now();
    const model = req.model || "mistralai/mistral-7b"; // Free-tier compatible model
    const messages = [{ role: "user", content: req.prompt }];

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
          "HTTP-Referer": "https://pa360.net",
          "X-Title": "Project Athlete 360 AI",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: req.temperature ?? 0.7,
          max_tokens: req.maxTokens ?? 512,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error(`[AI:OpenRouter] Error ${response.status}: ${text}`);
        return {
          success: false,
          provider: "openrouter",
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const output = data.choices?.[0]?.message?.content || "";
      const latency = Date.now() - start;

      return {
        success: true,
        provider: "openrouter",
        data: output,
        latencyMs: latency,
      };
    } catch (err: any) {
      logger.error(`[AI:OpenRouter] Generation failed: ${err.message}`);
      return {
        success: false,
        provider: "openrouter",
        error: err.message,
      };
    }
  },

  getHealth: async () => {
    if (!API_KEY) return { healthy: false, info: "API key missing" };
    return { healthy: true, info: "OpenRouter ready" };
  },
};