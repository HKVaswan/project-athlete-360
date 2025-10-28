import { Request, Response, NextFunction } from "express";
import { ObjectSchema } from "joi";
import logger from "../logger";

/**
 * ✅ Middleware: Validate request body, query, or params using Joi schemas.
 * Supports context-based validation and produces consistent API errors.
 */
export const validate =
  (schema: ObjectSchema, property: "body" | "query" | "params" = "body") =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error, value } = schema.validate(req[property], {
        abortEarly: false, // show all validation errors
        allowUnknown: false,
        stripUnknown: true, // remove extra fields
      });

      if (error) {
        const errors = error.details.map((d) => d.message);
        logger.warn(`[VALIDATION] ${errors.join(", ")} - ${req.originalUrl}`);
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors,
        });
      }

      // Replace with sanitized validated data
      (req as any)[property] = value;
      next();
    } catch (err: any) {
      logger.error(`[VALIDATION ERROR] ${err.message}`);
      return res.status(500).json({
        success: false,
        message: "Internal validation error",
      });
    }
  };