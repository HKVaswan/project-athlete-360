// src/integrations/aiPolicyManager.ts
/**
 * AI Policy Manager
 * ---------------------------------------------------------------------------
 * Enterprise-grade governance layer for AI interactions.
 *
 * Responsibilities:
 *  ✅ Enforces ethical, privacy, and domain-specific policies.
 *  ✅ Defines allow/deny rules for prompts and generated responses.
 *  ✅ Maintains versioned policy registry (can be synced from DB or config).
 *  ✅ Handles consent-based access and compliance (GDPR / COPPA / Athlete Data).
 *  ✅ Works seamlessly with aiEthicsGuard and aiModelOrchestrator.
 *
 * This ensures every AI action in Project Athlete 360 is safe, lawful,
 * and aligned with platform values of fairness, safety, and integrity.
 */

import logger from "../logger";
import { config } from "../config";
import { aiEthicsGuard } from "./aiEthicsGuard";
import { AIRequest, AIResponse } from "./aiProviderManager";
import { Errors } from "../utils/errors";

/** Policy Types */
export type PolicyCategory = "privacy" | "ethics" | "security" | "performance" | "general";

/** Policy Rule Interface */
export interface PolicyRule {
  id: string;
  category: PolicyCategory;
  description: string;
  condition: (req: AIRequest, res?: AIResponse) => boolean | Promise<boolean>;
  action: "allow" | "deny" | "warn" | "requireConsent";
  message?: string;
}

/** Policy Violation Structure */
export interface PolicyViolation {
  id: string;
  category: PolicyCategory;
  action: string;
  message: string;
  timestamp: string;
}

/**
 * AI Policy Manager
 */
export class AiPolicyManager {
  private rules: PolicyRule[] = [];
  private consentedUsers: Set<string> = new Set();

  constructor() {
    this.loadDefaultPolicies();
  }

  /**
   * Load a baseline policy set — extendable dynamically at runtime.
   */
  private loadDefaultPolicies() {
    this.rules = [
      {
        id: "ethics-001",
        category: "ethics",
        description: "Block harmful or discriminatory content in prompts",
        condition: async (req: AIRequest) => {
          const result = await aiEthicsGuard.validatePrompt(req.prompt);
          return result.ok;
        },
        action: "deny",
        message: "Prompt violates ethical guidelines",
      },
      {
        id: "privacy-001",
        category: "privacy",
        description: "Disallow AI access to personally identifiable information (PII) without consent",
        condition: (req: AIRequest) => {
          const piiPattern = /\b(\d{10}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/;
          return !piiPattern.test(req.prompt);
        },
        action: "requireConsent",
        message: "Detected potential PII — explicit consent required",
      },
      {
        id: "security-001",
        category: "security",
        description: "Prevent sensitive system-level commands or prompts",
        condition: (req: AIRequest) => {
          return !/delete|shutdown|drop\s+table|reset|system|root|sudo/gi.test(req.prompt);
        },
        action: "deny",
        message: "Prompt contains restricted system command",
      },
      {
        id: "performance-001",
        category: "performance",
        description: "Limit request size for model stability",
        condition: (req: AIRequest) => (req.prompt?.length ?? 0) < 5000,
        action: "deny",
        message: "Prompt too long — exceeds maximum length limit",
      },
      {
        id: "general-001",
        category: "general",
        description: "Prevent use of AI in decision-making without human supervision",
        condition: () => true,
        action: "warn",
        message: "AI output requires human validation before final decision",
      },
    ];

    logger.info(`[AI PolicyManager] Loaded ${this.rules.length} base policies`);
  }

  /**
   * Register new runtime policy (from DB or config)
   */
  public registerPolicy(rule: PolicyRule) {
    if (this.rules.find((r) => r.id === rule.id)) {
      throw new Error(`Policy ${rule.id} already exists`);
    }
    this.rules.push(rule);
    logger.info(`[AI PolicyManager] Registered new rule: ${rule.id}`);
  }

  /**
   * Evaluate policies for a given AI request (and optional response)
   */
  public async evaluate(req: AIRequest, res?: AIResponse, userId?: string): Promise<{ allowed: boolean; violations: PolicyViolation[] }> {
    const violations: PolicyViolation[] = [];

    for (const rule of this.rules) {
      try {
        const ok = await rule.condition(req, res);
        if (!ok) {
          violations.push({
            id: rule.id,
            category: rule.category,
            action: rule.action,
            message: rule.message || "Policy violation",
            timestamp: new Date().toISOString(),
          });

          // handle action type
          if (rule.action === "deny") {
            logger.warn(`[AI PolicyManager] Denied request due to rule: ${rule.id}`);
            return { allowed: false, violations };
          }

          if (rule.action === "requireConsent" && userId && !this.consentedUsers.has(userId)) {
            logger.warn(`[AI PolicyManager] User ${userId} must consent before continuing`);
            return { allowed: false, violations };
          }
        }
      } catch (err: any) {
        logger.error(`[AI PolicyManager] Error in rule ${rule.id}: ${err.message}`);
        violations.push({
          id: rule.id,
          category: rule.category,
          action: "error",
          message: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { allowed: true, violations };
  }

  /**
   * Explicit user consent for specific AI operations
   */
  public grantConsent(userId: string) {
    this.consentedUsers.add(userId);
    logger.info(`[AI PolicyManager] Consent granted for user ${userId}`);
  }

  public revokeConsent(userId: string) {
    this.consentedUsers.delete(userId);
    logger.info(`[AI PolicyManager] Consent revoked for user ${userId}`);
  }

  /**
   * Export current policy set (for admin dashboard or audit logs)
   */
  public exportPolicies() {
    return this.rules.map((r) => ({
      id: r.id,
      category: r.category,
      description: r.description,
      action: r.action,
    }));
  }

  /**
   * Health check for auditing and diagnostics
   */
  public async healthCheck() {
    return {
      loadedPolicies: this.rules.length,
      consentedUsers: this.consentedUsers.size,
      version: config.version || "1.0",
      status: "ok",
    };
  }
}

// Singleton export for system-wide policy use
export const aiPolicyManager = new AiPolicyManager();
export default aiPolicyManager;