// src/middleware/aiRequestValidator.ts

import { Request, Response, NextFunction } from "express";
import logger from "../logger";

/**
 * Middleware: Validates AI Request Inputs
 * - Prevents prompt injection and malicious payloads
 * - Limits prompt size and complexity
 * - Ensures type safety for structured AI tasks
 * - Logs rejected prompts for admin review (without storing private content)
 */

const MAX_PROMPT_LENGTH = 4000;
const DISALLOWED_PATTERNS = [
  /delete\s+from/i,
  /drop\s+table/i,
  /system\s*override/i,
  /ignore\s+policy/i,
  /prompt\s*injection/i,
  /bypass\s+restriction/i,
];

export const validateAiRequest = (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, model, type } = req.body;

    // 1️⃣  Basic field checks
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ success: false, message: "Prompt is required and must be a string" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      logger.warn(`[AIValidator] Rejected overlong prompt (${prompt.length} chars)`);
      return res.status(413).json({ success: false, message: "Prompt too long" });
    }

    // 2️⃣  Check for injection or system override patterns
    for (const pattern of DISALLOWED_PATTERNS) {
      if (pattern.test(prompt)) {
        logger.warn(`[AIValidator] Detected disallowed pattern in prompt`, { pattern: pattern.toString() });
        return res.status(403).json({
          success: false,
          message: "Unsafe or policy-violating content detected in prompt",
        });
      }
    }

    // 3️⃣  Optional: Validate model or type hints
    if (model && typeof model !== "string") {
      return res.status(400).json({ success: false, message: "Invalid model type" });
    }

    if (type && !["performance", "feedback", "insight", "custom"].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid AI task type" });
    }

    // 4️⃣  Sanitization (basic HTML escape)
    req.body.prompt = prompt.replace(/[<>]/g, "");

    // 5️⃣  Log approved requests (only metadata)
    logger.debug(`[AIValidator] Valid AI request from ${req.user?.id || "guest"}`);

    next();
  } catch (err: any) {
    logger.error(`[AIValidator] ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: "AI validation failed" });
  }
};