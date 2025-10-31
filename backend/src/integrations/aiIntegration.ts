// src/integrations/aiIntegration.ts

import axios from "axios";
import { logger } from "../logger";
import { config } from "../config";
import NodeCache from "node-cache";

/**
 * Enterprise-grade AI Integration Module
 * --------------------------------------
 * - Works with free-tier AI models (Gemini, OpenRouter, or Ollama)
 * - Includes request caching & rate limiting
 * - Graceful fallbacks if one AI provider fails
 * - Central interface for all AI features (analysis, predictions, summaries)
 */

const cache = new NodeCache({ stdTTL: 60 * 5 }); // 5-minute cache
const RATE_LIMIT = 15; // max 15 requests/minute per instance
let requestCount = 0;
let lastReset = Date.now();

type AIProvider = "GEMINI" | "OPENROUTER" | "OLLAMA";

export class AIIntegration {
  private provider: AIProvider;

  constructor(provider: AIProvider = "GEMINI") {
    this.provider = provider;
  }

  /**
   * Global AI entry point
   * @param prompt User/system prompt to process
   * @param options Additional metadata for context (type, mode, etc.)
   */
  async query(prompt: string, options?: Record<string, any>): Promise<string> {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error("AI prompt cannot be empty");
    }

    // simple rate limiter
    const now = Date.now();
    if (now - lastReset >= 60000) {
      requestCount = 0;
      lastReset = now;
    }
    if (requestCount >= RATE_LIMIT) {
      logger.warn("[AI] Rate limit exceeded — delaying request.");
      await new Promise((r) => setTimeout(r, 2000));
    }
    requestCount++;

    // Cache hit check
    const cacheKey = `${this.provider}:${prompt.slice(0, 200)}`;
    const cached = cache.get<string>(cacheKey);
    if (cached) return cached;

    let responseText = "";
    try {
      switch (this.provider) {
        case "GEMINI":
          responseText = await this.callGemini(prompt);
          break;
        case "OPENROUTER":
          responseText = await this.callOpenRouter(prompt);
          break;
        case "OLLAMA":
          responseText = await this.callOllama(prompt);
          break;
      }

      // Cache successful responses
      cache.set(cacheKey, responseText);
      return responseText;
    } catch (err: any) {
      logger.error(`[AIIntegration] ${this.provider} failed:`, err.message);

      // fallback strategy
      if (this.provider !== "OPENROUTER") {
        logger.warn("[AIIntegration] Falling back to OpenRouter model...");
        try {
          responseText = await this.callOpenRouter(prompt);
          return responseText;
        } catch (fallbackErr: any) {
          logger.error("[AIIntegration] Fallback AI also failed:", fallbackErr.message);
          throw new Error("All AI services unavailable at the moment.");
        }
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────
  // PROVIDER IMPLEMENTATIONS
  // ──────────────────────────────────────────────

  private async callGemini(prompt: string): Promise<string> {
    const apiKey = config.geminiApiKey;
    if (!apiKey) throw new Error("Gemini API key not configured");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
    const body = { contents: [{ parts: [{ text: prompt }] }] };

    const { data } = await axios.post(url, body, { timeout: 15000 });
    const output = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
    return output.trim();
  }

  private async callOpenRouter(prompt: string): Promise<string> {
    const apiKey = config.openRouterKey;
    if (!apiKey) throw new Error("OpenRouter API key not configured");

    const { data } = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemma-2b-it", // free lightweight model
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://pa360.net",
          "X-Title": "ProjectAthlete360-AI",
        },
        timeout: 15000,
      }
    );

    const output = data?.choices?.[0]?.message?.content || "No response.";
    return output.trim();
  }

  private async callOllama(prompt: string): Promise<string> {
    const url = config.ollamaUrl || "http://localhost:11434/api/generate";
    const body = { model: "llama3", prompt };

    const { data } = await axios.post(url, body, { timeout: 15000 });
    return data?.response || "No response.";
  }

  // ──────────────────────────────────────────────
  // HEALTH & UTILITY METHODS
  // ──────────────────────────────────────────────

  async healthCheck() {
    return {
      provider: this.provider,
      cacheKeys: cache.keys().length,
      requestCount,
      lastReset: new Date(lastReset).toISOString(),
    };
  }

  switchProvider(provider: AIProvider) {
    this.provider = provider;
    logger.info(`[AIIntegration] Switched to provider: ${provider}`);
  }
}

export const aiIntegration = new AIIntegration("GEMINI");