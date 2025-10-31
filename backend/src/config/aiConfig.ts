// src/config/aiConfig.ts

import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

/**
 * 🧠 AI Configuration
 * Central configuration for all AI services and integrations.
 * 
 * - Supports multiple provider keys (Gemini, OpenRouter, HuggingFace, Mistral, Ollama)
 * - Includes safety & compliance parameters (like blocklists and filters)
 * - Tunable defaults for temperature, max tokens, and concurrency
 * - Structured in a way that can easily be extended to support new providers
 */

// Load blocklist if available
const blocklistPath = path.join(process.cwd(), "config", "ai-blocklist.json");
let blocklist: string[] = [];
if (fs.existsSync(blocklistPath)) {
  try {
    const data = fs.readFileSync(blocklistPath, "utf8");
    blocklist = JSON.parse(data);
  } catch {
    console.warn("[AI Config] ⚠️ Failed to load blocklist, using empty list");
  }
}

export const aiConfig = {
  // 🔑 API Keys and URLs
  providers: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || "",
      apiUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    },
    huggingface: {
      apiKey: process.env.HUGGINGFACE_API_KEY || "",
      apiUrl: "https://api-inference.huggingface.co/models",
    },
    mistral: {
      apiKey: process.env.MISTRAL_API_KEY || "",
      apiUrl: "https://api.mistral.ai/v1",
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY || "",
      apiUrl: "https://openrouter.ai/api/v1",
    },
    ollama: {
      baseUrl: process.env.OLLAMA_URL || "http://localhost:11434/api",
    },
    local: {
      enabled: true,
      maxPromptLength: 2000,
    },
  },

  // 🧩 AI Parameters
  defaults: {
    temperature: 0.7,
    maxTokens: 1024,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    timeoutMs: 20_000,
  },

  // 🚨 Safety and Ethical Constraints
  safety: {
    policyBlocklist: blocklist,
    enforceSafeMode: true,
    contentFilter: true,
    profanityFilter: true,
    maxPromptLength: 5000,
    auditLogsEnabled: true,
  },

  // 📊 Monitoring and Metrics
  monitoring: {
    enableMetrics: true,
    latencyThresholdMs: 5000,
    retryLimit: 3,
    circuitBreaker: {
      failureThreshold: 5,
      openPeriodMs: 60_000,
    },
  },

  // ⚙️ AI Cache Config
  cache: {
    enabled: true,
    ttl: 600, // 10 min default
    provider: "redis",
  },

  // 🧠 Experimental Features
  experimental: {
    selfLearning: process.env.AI_SELF_LEARNING === "true",
    hybridMode: process.env.AI_HYBRID_MODE === "true",
    offlineFallback: true,
  },
};

export type AIConfig = typeof aiConfig;

export default aiConfig;