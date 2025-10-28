import { Request, Response, NextFunction } from "express";
import { ObjectSchema } from "joi";
import { ZodSchema, ZodError } from "zod";
import logger from "../logger";

// ───────────────────────────────
// 🧠 Generic Request Validator
// Supports both Joi and Zod schemas seamlessly
// ───────────────────────────────

export const validateRequest =
  (schema: ObjectSchema | ZodSchema, property: "body" | "query" | "params" = "body") =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req[property];

      // Joi schema validation
      if ("validate" in schema) {
        const { error, value } = (schema as ObjectSchema).validate(data, {
          abortEarly: false,
          allowUnknown: true,
          stripUnknown: true,
        });
        if (error) {
          const details = error.details.map((d) => d.message);
          logger.warn(`[VALIDATION] ${property} failed: ${details.join(", ")}`);
          return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: details,
          });
        }
        req[property] = value;
      }

      // Zod schema validation
      else if ("safeParse" in schema) {
        const result = (schema as ZodSchema).safeParse(data);
        if (!result.success) {
          const details = result.error.errors.map((e) => e.message);
          logger.warn(`[VALIDATION] ${property} failed: ${details.join(", ")}`);
          return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: details,
          });
        }
        req[property] = result.data;
      }

      next();
    } catch (err: any) {
      logger.error(`[VALIDATION ERROR] ${err.message || err}`);
      return res.status(500).json({
        success: false,
        message: "Server error during validation",
      });
    }
  };