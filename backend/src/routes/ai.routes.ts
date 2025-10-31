// src/routes/ai.routes.ts

import { Router } from "express";
import aiManager from "../integrations/ai.bootstrap";
import { validateAiRequest } from "../middleware/aiRequestValidator";
import { authGuard } from "../middleware/authGuard";
import logger from "../logger";

const router = Router();

/**
 * @route   POST /api/ai/generate
 * @desc    Generate AI response (performance tips, insights, etc.)
 * @access  Authenticated users only
 */
router.post("/generate", authGuard, validateAiRequest, async (req, res) => {
  try {
    const { prompt, type, maxTokens, temperature } = req.body;

    const result = await aiManager.generate({
      prompt,
      type,
      maxTokens,
      temperature,
    });

    if (!result.success) {
      return res.status(502).json({
        success: false,
        message: `AI request failed via ${result.provider}`,
        error: result.error,
      });
    }

    res.json({
      success: true,
      provider: result.provider,
      latencyMs: result.latencyMs,
      response: result.data,
    });
  } catch (err: any) {
    logger.error(`[AI Route] ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: "AI generation failed" });
  }
});

/**
 * @route   GET /api/ai/health
 * @desc    Health status of AI providers
 * @access  System Admins only (can extend to general admins with limited info)
 */
router.get("/health", authGuard, async (req, res) => {
  try {
    const health = await aiManager.healthCheck();
    res.json({ success: true, health });
  } catch (err: any) {
    logger.error(`[AI Health] ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: "AI health check failed" });
  }
});

/**
 * @route   POST /api/ai/shutdown
 * @desc    Gracefully stop all AI services (for system admin use)
 * @access  Super Admin only
 */
router.post("/shutdown", authGuard, async (req, res) => {
  try {
    const userRole = (req as any).user?.role;
    if (userRole !== "superadmin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    await aiManager.shutdown();
    res.json({ success: true, message: "AI services stopped successfully" });
  } catch (err: any) {
    logger.error(`[AI Shutdown] ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: "AI shutdown failed" });
  }
});

export default router;