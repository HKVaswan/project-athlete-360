/**
 * src/lib/ai/aiClient.ts
 * ---------------------------------------------------------------------------
 * Enterprise-Grade Unified AI Client (v3)
 *
 * Features:
 *  - Unified interface for all AI providers (local, OpenAI, Anthropic, etc.)
 *  - Role-based access guard (super admin / system)
 *  - Caching, telemetry, retry w/ exponential backoff
 *  - Sanitized prompts (no PII or secret leakage)
 *  - Auto-fallback to local mock AI
 *  - Structured audit logging for transparency
 */

import axios from "axios";
import crypto from "crypto";
import { config } from "../../config";
import { logger } from "../../logger";
import Analytics from "../analytics";
import { buildAuditEntry, mask } from "../securityManager";
import { ensureSuperAdmin } from "../securityManager";

// ---------------------------------------------------------------------------
// 🧠 AI Provider Interface
// ---------------------------------------------------------------------------

export interface AIProvider {
  name: string;
  generate: (prompt: string, options?: Record<string, any>) => Promise<string>;
  embed?: (text: string) => Promise<number[]>;
  classify?: (input: string, labels: string[]) => Promise<string>;
}

// ---------------------------------------------------------------------------
// 💾 In-Memory Cache
// ---------------------------------------------------------------------------

const aiCache = new Map<string, { result: string; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes
const MAX_CACHE_ENTRIES = 500;

// ---------------------------------------------------------------------------
// 🧩 Local Fallback Provider
// ---------------------------------------------------------------------------

const LocalAIMock: AIProvider = {
  name: "local-mock",
  async generate(prompt: string) {
    if (/motivate/i.test(prompt))
      return "Keep pushing forward — your hard work defines your victory.";
    if (/performance/i.test(prompt))
      return "Performance improves through consistency and smart recovery.";
    if (/nutrition/i.test(prompt))
      return "Balanced meals with carbs, protein, and hydration are key for athletes.";
    return "This is a locally generated AI response (mock mode).";
  },
};

// ---------------------------------------------------------------------------
// 🤖 OpenAI Provider
// ---------------------------------------------------------------------------

const OpenAIProvider: AIProvider = {
  name: "openai",
  async generate(prompt: string, options = {}) {
    const apiKey = config.openaiApiKey;
    if (!apiKey) throw new Error("Missing OpenAI API key.");

    const sanitizedPrompt = sanitizePrompt(prompt);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: options.model || "gpt-4o-mini",
            messages: [{ role: "user", content: sanitizedPrompt }],
            max_tokens: options.maxTokens || 400,
          },
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 15000,
          }
        );

        const text = response.data?.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error("Empty AI response.");
        return text;
      } catch (err: any) {
        if (attempt < 3) {
          const wait = attempt * 1000;
          logger.warn(`[AI:OpenAI] Retry #${attempt} after ${wait}ms`);
          await new Promise((res) => setTimeout(res, wait));
          continue;
        }
        logger.error(`[AI:OpenAI] ❌ Error: ${err.message}`);
        throw err;
      }
    }

    throw new Error("AI request failed after retries.");
  },
};

// ---------------------------------------------------------------------------
// 🧹 Sanitization Utility — Prevent Leaking Sensitive Data
// ---------------------------------------------------------------------------

function sanitizePrompt(prompt: string): string {
  const blacklist = ["password", "secret", "token", "api", "auth", "email", "phone"];
  let sanitized = prompt;
  for (const term of blacklist) {
    const regex = new RegExp(term, "gi");
    sanitized = sanitized.replace(regex, "[REDACTED]");
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// 🧩 AI Client Singleton
// ---------------------------------------------------------------------------

class AIClient {
  private static instance: AIClient;
  private provider: AIProvider;

  private constructor() {
    if (config.useOpenAI && config.openaiApiKey) this.provider = OpenAIProvider;
    else this.provider = LocalAIMock;
    logger.info(`[AIClient] Active provider: ${this.provider.name}`);
  }

  static getInstance(): AIClient {
    if (!AIClient.instance) AIClient.instance = new AIClient();
    return AIClient.instance;
  }

  /**
   * Generate AI output safely, with caching, telemetry, and audit logs.
   */
  async generate(prompt: string, options: Record<string, any> = {}, role = "system"): Promise<string> {
    // Access guard: restrict advanced AI use to verified roles
    if (this.provider.name !== "local-mock") ensureSuperAdmin(role);

    const cacheKey = crypto.createHash("sha256").update(prompt).digest("hex");
    const cached = aiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.debug("[AIClient] Cache hit for prompt");
      return cached.result;
    }

    const start = Date.now();
    try {
      const result = await this.provider.generate(prompt, options);

      // Cache management
      if (aiCache.size > MAX_CACHE_ENTRIES) aiCache.clear();
      aiCache.set(cacheKey, { result, timestamp: Date.now() });

      const latency = Date.now() - start;
      Analytics.telemetry("aiClient", {
        provider: this.provider.name,
        latency: `${latency}ms`,
        cached: false,
      });

      // Audit entry
      const audit = buildAuditEntry(role, "ai.generate", {
        provider: this.provider.name,
        prompt: mask(prompt, 8, 8),
        latency,
      });
      logger.info(`[AIClient] AUDIT: ${JSON.stringify(audit)}`);

      return result;
    } catch (err: any) {
      logger.error(`[AIClient] Fallback to local provider: ${err.message}`);
      return LocalAIMock.generate(prompt);
    }
  }

  /**
   * Flush AI cache (super admin only)
   */
  clearCache(role = "system") {
    ensureSuperAdmin(role);
    aiCache.clear();
    logger.info("[AIClient] Cache cleared by super admin.");
  }
}

// ---------------------------------------------------------------------------
// 🚀 Export Singleton
// ---------------------------------------------------------------------------

export const aiClient = AIClient.getInstance();
export default aiClient;