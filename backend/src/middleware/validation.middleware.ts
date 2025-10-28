import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError } from "zod";
import logger from "../logger";

// ───────────────────────────────
// 🧩 Zod Validation Middleware
// ───────────────────────────────
export const validate =
  (schema: AnyZodObject, source: "body" | "query" | "params" = "body") =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Parse & validate input
      await schema.parseAsync(req[source]);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formatted = error.errors.map((err) => ({
          path: err.path.join("."),
          message: err.message,
        }));

        logger.warn("Validation failed", {
          source,
          endpoint: req.originalUrl,
          errors: formatted,
        });

        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: formatted,
        });
      }

      logger.error("Unexpected validation middleware error", { error });
      res.status(500).json({
        success: false,
        message: "Server error during validation",
      });
    }
  };