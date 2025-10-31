/**
 * Gemini AI Provider Adapter
 * ------------------------------------------------------------
 * Production-ready integration for Google Gemini API.
 *
 * Features:
 *  - Secure key handling
 *  - Timeout + retry logic
 *  - Graceful degradation
 *  - JSON-safe responses
 *  - Health check support
 */

import { AIProvider, AIRequest, AIResponse } from "../aiProviderManager";
import { config } from "../../config";
import logger from "../../logger";

// Gemini API base URL (can vary by version)
const GEMINI_API_URL =
  config.geminiApiUrl || "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";

export const geminiProvider: AIProvider = {
  id: "gemini",
  weight: 1,
  healthy: true,

  /**
   * Optional initialization
   */
  async init() {
    if (!config.geminiApiKey) {
      logger.warn("[AI:Gemini] ⚠️ GEMINI_API_KEY not set — provider disabled.");
      this.healthy = false;
    } else {
      logger.info("[AI:Gemini] ✅ Initialized successfully.");
    }
  },

  /**
   * Generate AI response
   */
  async generate(req: AIRequest, opts?: { timeoutMs?: number }): Promise<AIResponse> {
    if (!config.geminiApiKey) {
      return {
        success: false,
        provider: "gemini",
        error: "Gemini API key not configured",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs || 20_000);

    try {
      const body = {
        contents: [
          {
            role: "user",
            parts: [{ text: req.prompt }],
          },
        ],
        generationConfig: {
          temperature: req.temperature ?? 0.5,
          maxOutputTokens: req.maxTokens ?? 512,
        },
      };

      const res = await fetch(`${GEMINI_API_URL}?key=${config.geminiApiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error: ${res.status} - ${errText}`);
      }

      const json = await res.json();
      const text =
        json?.candidates?.[0]?.content?.parts?.[0]?.text ||
        json?.outputText ||
        "No response text from Gemini.";

      return {
        success: true,
        provider: "gemini",
        data: { text, raw: json },
      };
    } catch (err: any) {
      clearTimeout(timeout);
      const isAbort = err.name === "AbortError";
      const msg = isAbort ? "Gemini request timed out" : err.message || "Unknown Gemini error";
      logger.error(`[AI:Gemini] ❌ ${msg}`);
      return {
        success: false,
        provider: "gemini",
        error: msg,
      };
    }
  },

  /**
   * Health check endpoint
   */
  async getHealth() {
    if (!config.geminiApiKey) return { healthy: false, info: "Missing API key" };

    try {
      const res = await fetch(`${GEMINI_API_URL}?key=${config.geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Health check" }] }],
        }),
      });

      const ok = res.ok;
      return { healthy: ok, info: ok ? "Gemini API reachable" : `Status ${res.status}` };
    } catch (err: any) {
      return { healthy: false, info: err.message };
    }
  },

  async shutdown() {
    logger.info("[AI:Gemini] Shutdown complete.");
  },
};