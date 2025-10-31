// src/controllers/ai/aiController.ts

import { Request, Response } from "express";
import aiManager from "../../integrations/ai.bootstrap";
import { aiHealthCheck } from "../../integrations/ai.bootstrap";
import { aiPolicyManager } from "../../integrations/aiPolicyManager";
import logger from "../../logger";
import { rateLimitAIUsage } from "../../middleware/rateLimit.middleware"; // optional
import { validateAiRequest } from "../../middleware/aiRequestValidator"; // we’ll create this next

/**
 * POST /api/ai/query
 * Generic AI query endpoint.
 * Accepts { prompt, context, model, options }
 */
export const queryAI = async (req: Request, res: Response) => {
  try {
    const { prompt, model, options } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ success: false, message: "Prompt is required" });
    }

    // Validate against policy manager (content, ethics, etc.)
    const isAllowed = await aiPolicyManager.validatePrompt(prompt, req.user);
    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: "Prompt violates AI policy or contains restricted content",
      });
    }

    // Execute query through AI orchestrator
    const result = await aiManager.generate(
      { prompt, model, ...options },
      { timeoutMs: 25000 }
    );

    if (!result.success) {
      logger.warn(`[AIController] AI query failed: ${result.error}`);
      return res.status(500).json({ success: false, message: result.error });
    }

    // Optional: Log AI usage
    logger.info(`[AI] query executed by user ${req.user?.id || "guest"}`);

    res.status(200).json({
      success: true,
      provider: result.provider,
      latency: result.latencyMs,
      output: result.data,
    });
  } catch (err: any) {
    logger.error(`[AIController] ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
  }
};

/**
 * GET /api/ai/health
 * Returns current AI provider health status.
 */
export const aiHealth = async (_req: Request, res: Response) => {
  try {
    const health = await aiHealthCheck();
    res.status(200).json({ success: true, health });
  } catch (err: any) {
    logger.error(`[AIHealth] ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/ai/insight
 * Request for AI-based insights (performance, feedback, etc.)
 * Example: { type: "performance", data: {...} }
 */
export const generateInsight = async (req: Request, res: Response) => {
  try {
    const { type, data } = req.body;
    if (!type || !data) {
      return res.status(400).json({ success: false, message: "type and data are required" });
    }

    const prompt = `Generate ${type} insights for athlete data: ${JSON.stringify(data).slice(0, 1500)}`;
    const result = await aiManager.generate({ prompt, temperature: 0.7 });

    if (!result.success) throw new Error(result.error);

    res.status(200).json({
      success: true,
      insight: result.data,
      provider: result.provider,
      latency: result.latencyMs,
    });
  } catch (err: any) {
    logger.error(`[AI Insight] ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Optional endpoint: For system admins or monitoring dashboards
 */
export const aiStats = async (_req: Request, res: Response) => {
  try {
    const metrics = await aiManager.healthCheck();
    res.status(200).json({ success: true, metrics });
  } catch (err: any) {
    logger.error(`[AI Stats] ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
};