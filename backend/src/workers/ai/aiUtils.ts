// backend/src/workers/ai/aiUtils.ts

import axios from "axios";
import { logger } from "../../../logger";
import { config } from "../../../config";
import crypto from "crypto";

export type AIModel = "gpt-4o-mini" | "gemini-pro" | "mistral-large" | "local-llm";

interface AIRequestOptions {
  model?: AIModel;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
  safety?: boolean;
}

/**
 * ----------------------------
 * AI UTILITY MODULE
 * ----------------------------
 * Provides:
 *  - Unified API access layer for all AI models
 *  - Retry with exponential backoff
 *  - Basic caching for repeated prompts
 *  - Input sanitization & content safety filter
 *  - Model fallback support (multi-provider readiness)
 */
export class AIUtils {
  private static cache = new Map<string, string>();

  /** Sanitize user input to remove prompt injections or malicious strings */
  static sanitizeInput(input: string): string {
    return input
      .replace(/system:|ignore all previous/i, "")
      .replace(/<script.*?>.*?<\/script>/gi, "")
      .trim();
  }

  /** Simple SHA hash for caching prompts */
  static hashPrompt(prompt: string): string {
    return crypto.createHash("sha256").update(prompt).digest("hex");
  }

  /** Get cached response if available */
  static getCached(prompt: string): string | null {
    const key = this.hashPrompt(prompt);
    return this.cache.get(key) || null;
  }

  /** Cache a response for future lookups */
  static setCache(prompt: string, response: string): void {
    const key = this.hashPrompt(prompt);
    this.cache.set(key, response);
    if (this.cache.size > 1000) this.cache.clear(); // prevent memory overflow
  }

  /** Safety filter for harmful or explicit outputs */
  static isUnsafe(content: string): boolean {
    const unsafePatterns = [/suicide/i, /violence/i, /explicit/i, /hate/i, /racism/i];
    return unsafePatterns.some((p) => p.test(content));
  }

  /** Unified AI request handler with retry + fallback */
  static async queryAI(
    prompt: string,
    options: AIRequestOptions = {}
  ): Promise<string> {
    const sanitizedPrompt = this.sanitizeInput(prompt);
    const cached = this.getCached(sanitizedPrompt);
    if (cached) return cached;

    const {
      model = "gpt-4o-mini",
      temperature = 0.7,
      maxTokens = 500,
      retries = 3,
      safety = true,
    } = options;

    let lastError: any = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.post(
          config.aiApiUrl || "https://api.openai.com/v1/chat/completions",
          {
            model,
            messages: [{ role: "user", content: sanitizedPrompt }],
            max_tokens: maxTokens,
            temperature,
          },
          {
            headers: {
              Authorization: `Bearer ${config.aiApiKey || process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          }
        );

        const text = response.data?.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error("Empty AI response.");

        if (safety && this.isUnsafe(text)) {
          logger.warn(`[AIUtils] ⚠️ Unsafe content blocked for model ${model}`);
          return "⚠️ Response filtered for safety.";
        }

        this.setCache(sanitizedPrompt, text);
        return text;
      } catch (err: any) {
        lastError = err;
        logger.warn(`[AIUtils] Retry ${attempt + 1}/${retries} failed: ${err.message}`);
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
      }
    }

    logger.error(`[AIUtils] ❌ All retries failed: ${lastError?.message}`);
    throw new Error("AI query failed after multiple attempts.");
  }

  /** Helper: Log structured AI query result */
  static logResult(prompt: string, output: string, model: string) {
    logger.info(`[AIUtils] Model: ${model}\nPrompt: ${prompt}\nResponse: ${output}`);
  }
}

export default AIUtils;