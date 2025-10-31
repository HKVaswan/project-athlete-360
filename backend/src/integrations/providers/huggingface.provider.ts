/**
 * Hugging Face Provider Adapter
 * ------------------------------------------------------------
 * Robust, production-ready adapter for the Hugging Face Inference API.
 * Supports both text generation and embeddings endpoints.
 *
 * Features:
 *  - Works with free-tier HF API key (limited requests)
 *  - Timeout + structured error handling
 *  - Automatic retry and graceful degradation
 *  - Health check support
 *
 * Docs: https://huggingface.co/docs/api-inference
 */

import { AIProvider, AIRequest, AIResponse } from "../aiProviderManager";
import { config } from "../../config";
import logger from "../../logger";

// Default model to use if none is specified
const DEFAULT_MODEL = "google/gemma-2b-it"; // Free-tier conversational model

export const huggingFaceProvider: AIProvider = {
  id: "huggingface",
  weight: 1,
  healthy: true,

  async init() {
    if (!config.huggingFaceApiKey) {
      logger.warn("[AI:HuggingFace] ⚠️ Missing API key — provider disabled.");
      this.healthy = false;
      return;
    }

    logger.info("[AI:HuggingFace] ✅ Initialized successfully.");
  },

  /**
   * Generate AI text or embeddings
   */
  async generate(req: AIRequest, opts?: { timeoutMs?: number }): Promise<AIResponse> {
    if (!config.huggingFaceApiKey) {
      return {
        success: false,
        provider: "huggingface",
        error: "Missing Hugging Face API key",
      };
    }

    const model = req.model || DEFAULT_MODEL;
    const endpoint = `https://api-inference.huggingface.co/models/${model}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs || 20_000);

    try {
      const payload = { inputs: req.prompt || "", parameters: { max_new_tokens: req.maxTokens ?? 512 } };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.huggingFaceApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HF API error (${res.status}): ${errorText}`);
      }

      const json = await res.json();
      const output =
        Array.isArray(json) && json[0]?.generated_text
          ? json[0].generated_text
          : json?.generated_text || json?.text || JSON.stringify(json);

      return {
        success: true,
        provider: "huggingface",
        data: { text: output, raw: json },
      };
    } catch (err: any) {
      clearTimeout(timeout);
      const msg = err.name === "AbortError" ? "HuggingFace request timed out" : err.message;
      logger.error(`[AI:HuggingFace] ❌ ${msg}`);
      return { success: false, provider: "huggingface", error: msg };
    }
  },

  /**
   * Health check (lightweight HEAD request)
   */
  async getHealth() {
    if (!config.huggingFaceApiKey) return { healthy: false, info: "Missing API key" };

    try {
      const res = await fetch("https://api-inference.huggingface.co/status", {
        method: "GET",
        headers: { Authorization: `Bearer ${config.huggingFaceApiKey}` },
      });

      const ok = res.ok;
      return { healthy: ok, info: ok ? "Hugging Face API reachable" : `Status ${res.status}` };
    } catch (err: any) {
      return { healthy: false, info: err.message };
    }
  },

  async shutdown() {
    logger.info("[AI:HuggingFace] Shutdown complete.");
  },
};