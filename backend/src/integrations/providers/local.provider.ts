// src/integrations/providers/local.provider.ts
/**
 * Local AI Provider (fallback / dev)
 *
 * - Implements AIProvider interface used by aiProviderManager
 * - Deterministic, conservative responses to avoid hallucinations
 * - Lightweight operations: summarize, bullets, extract_dates, sentiment (very small heuristic)
 * - Honors a small max prompt size and returns structured AIResponse
 * - Safe to include in production as a last-resort fallback (low weight)
 */

import { AIProvider, AIRequest, AIResponse } from "../aiProviderManager";
import logger from "../../logger";
import { config } from "../../config";

const MAX_PROMPT_LENGTH = 4000; // characters (defensive)
const DEFAULT_TEMPERATURE = 0.0;

function truncatePrompt(prompt: string, max = MAX_PROMPT_LENGTH) {
  if (!prompt) return "";
  if (prompt.length <= max) return prompt;
  return prompt.slice(0, max) + " …[truncated]";
}

/** very small heuristic sentiment: counts positive/negative words */
function simpleSentiment(text: string) {
  const pos = ["good", "great", "improved", "excellent", "positive", "strong"];
  const neg = ["bad", "poor", "injury", "injured", "weak", "decline", "worse", "problem"];
  const l = text.toLowerCase();
  let score = 0;
  for (const w of pos) if (l.includes(w)) score++;
  for (const w of neg) if (l.includes(w)) score--;
  const label = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
  return { label, score };
}

/** create short bullet list from sentences (naive) */
function toBullets(text: string, maxBullets = 6) {
  const sentences = text
    .replace(/\n+/g, ". ")
    .split(/[.?!]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.slice(0, maxBullets).map((s) => `• ${s}`);
}

/** small summarizer: pick first + last sentences and a short stitched summary */
function naiveSummarize(text: string, maxLen = 280) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  const parts = cleaned.split(/[.?!]\s+/).filter(Boolean);
  if (parts.length === 0) return cleaned.slice(0, maxLen) + "…";
  const first = parts[0];
  const last = parts[parts.length - 1];
  const summary = `${first}. … ${last}.`;
  return summary.length <= maxLen ? summary : cleaned.slice(0, maxLen) + "…";
}

/** simple policy check using a blocklist from config (if configured) */
function policyCheck(prompt: string) {
  const blocklist = Array.isArray(config.aiPolicyBlocklist) ? config.aiPolicyBlocklist : [];
  if (!blocklist.length) return { ok: true };
  const lower = prompt.toLowerCase();
  for (const token of blocklist) {
    if (!token) continue;
    if (lower.includes(String(token).toLowerCase())) {
      return { ok: false, reason: `blocked content matched: ${token}` };
    }
  }
  return { ok: true };
}

export const localProvider: AIProvider = {
  id: "local-fallback",
  weight: 0.01, // very low: used only if others unavailable
  healthy: true,

  init: async () => {
    logger.info("[AI:local-fallback] initialized");
  },

  /**
   * Generate deterministic and conservative responses.
   * Supported quick ops (via req.hint || req.op):
   *  - summarize
   *  - bullets
   *  - sentiment
   *  - extract_dates (very naive)
   *
   * If no op requested, returns a safe echo with short trimmed prompt.
   */
  generate: async (req: AIRequest) => {
    try {
      const promptRaw = String(req.prompt ?? "");
      const prompt = truncatePrompt(promptRaw, MAX_PROMPT_LENGTH);

      // Policy guard
      const policy = policyCheck(prompt);
      if (!policy.ok) {
        return {
          success: false,
          provider: "local-fallback",
          error: `Prompt blocked by policy: ${policy.reason}`,
        } as AIResponse;
      }

      const op = (req.op || req.hint || req.task || "").toString().toLowerCase();
      const temperature = typeof req.temperature === "number" ? req.temperature : DEFAULT_TEMPERATURE;

      // Defensive: don't attempt NLP-heavy outputs when temperature is high — we are deterministic.
      if (temperature > 0.3) {
        logger.warn("[AI:local-fallback] temperature requested >0.3; forcing 0.0 for safety");
      }

      // Very small operation set
      switch (op) {
        case "summarize":
        case "summary": {
          const text = naiveSummarize(prompt, 400);
          return { success: true, provider: "local-fallback", data: { text } } as AIResponse;
        }

        case "bullets":
        case "bullet":
        case "extract_bullets": {
          const bullets = toBullets(prompt, 8);
          return { success: true, provider: "local-fallback", data: { bullets } } as AIResponse;
        }

        case "sentiment": {
          const sentiment = simpleSentiment(prompt);
          return { success: true, provider: "local-fallback", data: { sentiment } } as AIResponse;
        }

        case "extract_dates":
        case "dates": {
          // naive regex to find date-like tokens (dd/mm/yyyy, yyyy-mm-dd, month names)
          const isoMatches = Array.from(prompt.matchAll(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g)).map((m) => m[0]);
          const ddmmMatches = Array.from(prompt.matchAll(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g)).map((m) => m[0]);
          const monthMatches = Array.from(prompt.matchAll(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/gi)).map((m) => m[0]);
          const dates = Array.from(new Set([...isoMatches, ...ddmmMatches, ...monthMatches])).slice(0, 20);
          return { success: true, provider: "local-fallback", data: { dates } } as AIResponse;
        }

        default: {
          // fallback: echo safe digest
          const short = naiveSummarize(prompt, 300);
          const echo = `Local fallback response. This is a conservative, deterministic reply. Prompt excerpt: "${short}"`;
          return { success: true, provider: "local-fallback", data: { text: echo } } as AIResponse;
        }
      }
    } catch (err: any) {
      logger.error("[AI:local-fallback] generate error:", err?.message || err);
      return {
        success: false,
        provider: "local-fallback",
        error: "Local fallback generation failed",
      } as AIResponse;
    }
  },

  getHealth: async () => {
    // Local provider is always healthy unless explicitly disabled via config
    const disabled = !!config.disableLocalAiFallback;
    return { healthy: !disabled, info: { disabled } };
  },

  shutdown: async () => {
    logger.info("[AI:local-fallback] shutdown");
  },
};

export default localProvider;