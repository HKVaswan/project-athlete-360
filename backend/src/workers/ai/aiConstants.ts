// backend/src/workers/ai/aiConstants.ts

/**
 * AI Constants — Global definitions for AI modules
 * ------------------------------------------------------------
 * This file provides:
 *  - Centralized model registry
 *  - Safety threshold constants
 *  - System role templates
 *  - Performance tuning parameters
 *  - Compliance, ethics & fairness safeguards
 */

export const AI_MODELS = {
  OPENAI_GPT4: "gpt-4o-mini",
  OPENAI_GPT35: "gpt-3.5-turbo",
  GEMINI_PRO: "gemini-pro",
  MISTRAL_LARGE: "mistral-large",
  LOCAL_LLM: "local-llm",
} as const;

export type SupportedAIModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];

/**
 * Safety configuration to avoid inappropriate or unsafe responses.
 */
export const AI_SAFETY_LEVELS = {
  LOW: {
    blockExplicit: true,
    blockViolence: true,
    blockSensitive: true,
  },
  MEDIUM: {
    blockExplicit: true,
    blockViolence: true,
    blockSensitive: true,
    blockHate: true,
    blockSelfHarm: true,
  },
  HIGH: {
    blockExplicit: true,
    blockViolence: true,
    blockSensitive: true,
    blockHate: true,
    blockSelfHarm: true,
    blockMisinformation: true,
    requireReview: true,
  },
} as const;

/**
 * Defines temperature, max tokens, and retry limits by task type.
 * Helps optimize cost, accuracy, and stability.
 */
export const AI_TASK_PROFILES = {
  FEEDBACK_ANALYSIS: {
    temperature: 0.6,
    maxTokens: 600,
    retries: 2,
  },
  PERFORMANCE_EVAL: {
    temperature: 0.4,
    maxTokens: 800,
    retries: 3,
  },
  MENTAL_WELLNESS: {
    temperature: 0.7,
    maxTokens: 400,
    retries: 2,
  },
  STRATEGY_ADVICE: {
    temperature: 0.9,
    maxTokens: 1000,
    retries: 3,
  },
  DATA_SUMMARIZATION: {
    temperature: 0.3,
    maxTokens: 400,
    retries: 1,
  },
} as const;

/**
 * Ethical and compliance flags — applied globally.
 * (These can later be integrated into an AI governance dashboard)
 */
export const AI_ETHICS = {
  mustRespectPrivacy: true,
  mustAvoidBias: true,
  mustEnsureTransparency: true,
  mustExplainDecisions: true,
  mustPreserveConfidentiality: true,
};

/**
 * AI Scoring constants (used for feedback, analytics, and predictions)
 */
export const AI_SCORING = {
  MAX_CONFIDENCE: 1.0,
  MIN_CONFIDENCE: 0.0,
  ALERT_THRESHOLD: 0.25, // if confidence < 0.25, flag for human review
};

/**
 * System templates for consistent AI tone and behavior
 */
export const SYSTEM_TEMPLATES = {
  PERFORMANCE_ANALYST:
    "You are an experienced sports performance analyst. Use data to generate clear, actionable feedback for coaches and athletes.",
  WELLNESS_COACH:
    "You are a motivational sports psychologist. Respond empathetically and provide science-backed mental wellness tips.",
  STRATEGY_PLANNER:
    "You are a professional sports strategist. Provide practical and data-driven suggestions to optimize training sessions.",
  FEEDBACK_SUMMARIZER:
    "You summarize athlete feedback clearly and concisely, highlighting improvement points and confidence metrics.",
  SCOUT_ANALYST:
    "You are a professional sports scout. Objectively evaluate athlete profiles and match them to potential training programs or competitions.",
};

/**
 * Global AI runtime limits and timeouts
 */
export const AI_RUNTIME = {
  REQUEST_TIMEOUT_MS: 20000, // 20 seconds
  MAX_PARALLEL_JOBS: 5,
  JOB_RETRY_LIMIT: 3,
  CACHE_TTL_MS: 1000 * 60 * 30, // 30 minutes
};

/**
 * Metadata versioning for AI config management
 */
export const AI_VERSION = {
  schema: "1.0.0",
  lastUpdated: new Date().toISOString(),
};

export default {
  AI_MODELS,
  AI_SAFETY_LEVELS,
  AI_TASK_PROFILES,
  AI_ETHICS,
  AI_SCORING,
  SYSTEM_TEMPLATES,
  AI_RUNTIME,
  AI_VERSION,
};