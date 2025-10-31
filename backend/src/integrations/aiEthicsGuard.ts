// src/integrations/aiEthicsGuard.ts
import { logger } from "../logger";
import { config } from "../config";
import crypto from "crypto";

/**
 * AI Ethics Guard
 * -------------------------------------------------------------
 * - Filters unsafe, biased, or private-sensitive AI content.
 * - Monitors prompt & response before/after generation.
 * - Enforces platform-level AI policy rules.
 * - Logs every violation for later review by Super Admin.
 * - Future-proof: pluggable ethics rules and ML-based moderation.
 */

export interface EthicsResult {
  allowed: boolean;
  reasons?: string[];
  sanitizedPrompt?: string;
  sanitizedResponse?: string;
}

export interface EthicsRule {
  id: string;
  description: string;
  apply: (text: string, context?: any) => Promise<{ passed: boolean; reason?: string }>;
}

export class AiEthicsGuard {
  private static instance: AiEthicsGuard;
  private rules: EthicsRule[] = [];
  private sensitiveKeywords = [
    "password",
    "api key",
    "phone number",
    "email",
    "address",
    "aadhar",
    "pan",
    "credit card",
  ];
  private biasKeywords = [
    "caste",
    "religion",
    "gender bias",
    "politics",
    "ethnicity",
    "stereotype",
  ];
  private blockList = config.aiPolicyBlocklist || [];

  private constructor() {
    this.bootstrapDefaultRules();
  }

  public static getInstance() {
    if (!this.instance) this.instance = new AiEthicsGuard();
    return this.instance;
  }

  private bootstrapDefaultRules() {
    // 1️⃣ Sensitive Data Filter
    this.rules.push({
      id: "no-sensitive-info",
      description: "Disallow prompts that include private or sensitive data",
      apply: async (text: string) => {
        const lowered = text.toLowerCase();
        for (const keyword of this.sensitiveKeywords) {
          if (lowered.includes(keyword)) {
            return {
              passed: false,
              reason: `Contains sensitive keyword: ${keyword}`,
            };
          }
        }
        return { passed: true };
      },
    });

    // 2️⃣ Bias and Discrimination Filter
    this.rules.push({
      id: "no-bias",
      description: "Disallow bias, hate, or discriminatory prompts/responses",
      apply: async (text: string) => {
        const lowered = text.toLowerCase();
        for (const word of this.biasKeywords) {
          if (lowered.includes(word)) {
            return { passed: false, reason: `Potential bias or discrimination detected: ${word}` };
          }
        }
        return { passed: true };
      },
    });

    // 3️⃣ Blocklist Enforcement
    this.rules.push({
      id: "policy-blocklist",
      description: "Blocks terms defined in config.aiPolicyBlocklist",
      apply: async (text: string) => {
        const lowered = text.toLowerCase();
        for (const blocked of this.blockList) {
          if (lowered.includes(blocked.toLowerCase())) {
            return { passed: false, reason: `Contains blocked term: ${blocked}` };
          }
        }
        return { passed: true };
      },
    });
  }

  /**
   * Analyze and sanitize an AI prompt before sending to provider
   */
  public async validatePrompt(prompt: string, context?: any): Promise<EthicsResult> {
    const results = await Promise.all(this.rules.map((r) => r.apply(prompt, context)));
    const failed = results.filter((r) => !r.passed);

    if (failed.length > 0) {
      const reasons = failed.map((f) => f.reason || "Unknown violation");
      logger.warn(`[AI EthicsGuard] ❌ Prompt blocked: ${reasons.join(", ")}`);
      return {
        allowed: false,
        reasons,
      };
    }

    // Sanitization — remove potential PII-like patterns
    const sanitized = prompt.replace(/\b\d{10,}\b/g, "[REDACTED]").replace(/\S+@\S+\.\S+/g, "[EMAIL]");
    return { allowed: true, sanitizedPrompt: sanitized };
  }

  /**
   * Validate AI response post-generation for ethical compliance
   */
  public async validateResponse(response: string, context?: any): Promise<EthicsResult> {
    const results = await Promise.all(this.rules.map((r) => r.apply(response, context)));
    const failed = results.filter((r) => !r.passed);

    if (failed.length > 0) {
      const reasons = failed.map((f) => f.reason || "Unknown violation");
      logger.warn(`[AI EthicsGuard] ⚠️ Response flagged: ${reasons.join(", ")}`);
      return {
        allowed: false,
        reasons,
      };
    }

    // Remove personal identifiers
    const sanitized = response
      .replace(/\b\d{10,}\b/g, "[REDACTED]")
      .replace(/\S+@\S+\.\S+/g, "[EMAIL]")
      .replace(/(?:https?|ftp):\/\/[^\s]+/g, "[LINK]");
    return { allowed: true, sanitizedResponse: sanitized };
  }

  /**
   * Escalate any ethical violation for Super Admin review
   */
  public async escalateViolation(actorId: string | null, content: string, reasons: string[]) {
    const reportId = crypto.randomUUID();
    const filePath = path.join(process.cwd(), "logs", "ai-ethics", `${reportId}.json`);

    const payload = {
      id: reportId,
      timestamp: new Date().toISOString(),
      actorId,
      reasons,
      contentSnippet: content.slice(0, 500),
    };

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");

    logger.warn(`[AI EthicsGuard] 🚨 Violation report stored: ${reportId}`);
  }

  /**
   * Periodic health check for ethics engine
   */
  public async healthCheck() {
    return {
      activeRules: this.rules.length,
      blockListCount: this.blockList.length,
      healthy: true,
    };
  }
}

export const aiEthicsGuard = AiEthicsGuard.getInstance();