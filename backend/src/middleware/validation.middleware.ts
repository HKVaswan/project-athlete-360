// src/middleware/validation.middleware.ts

import { Request, Response, NextFunction } from "express";
import { ObjectSchema } from "joi";
import logger from "../logger";

/**
 * 🧩 Enterprise Validation Middleware
 * -----------------------------------
 * - Supports Joi schema validation for body/query/params
 * - Sanitizes, strips unknown fields
 * - Localized, structured error responses
 * - Auto-caps large payloads (security)
 * - Developer-friendly debug mode (non-prod)
 */

interface ValidationOptions {
  property?: "body" | "query" | "params";
  allowUnknown?: boolean;
  locale?: string; // e.g., "en" or "hi"
  logLevel?: "warn" | "error" | "info";
  sourceName?: string;
}

const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5 MB

export const validate =
  (schema: ObjectSchema, options: ValidationOptions = {}) =>
  (req: Request, res: Response, next: NextFunction) => {
    const {
      property = "body",
      allowUnknown = false,
      locale = "en",
      logLevel = "warn",
      sourceName = "API",
    } = options;

    try {
      // Security: Basic payload size guard
      const rawData = JSON.stringify(req[property]);
      if (Buffer.byteLength(rawData, "utf8") > MAX_PAYLOAD_SIZE) {
        logger.error(`[VALIDATION] Payload too large (${property}) from ${req.ip}`);
        return res.status(413).json({
          success: false,
          code: "PAYLOAD_TOO_LARGE",
          message: "Payload exceeds maximum allowed size (5 MB)",
        });
      }

      // Perform validation
      const { error, value } = schema.validate(req[property], {
        abortEarly: false,
        allowUnknown,
        stripUnknown: true,
        errors: { label: "key" },
      });

      if (error) {
        const errors = error.details.map((d) => ({
          field: d.path.join("."),
          message: localizeMessage(d.message, locale),
        }));

        // Log in structured format
        logger[logLevel](`[VALIDATION] ${sourceName} failed for ${req.originalUrl}`, {
          errors,
          method: req.method,
          ip: req.ip,
          userAgent: req.get("user-agent"),
        });

        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          errors,
          ...(process.env.NODE_ENV !== "production"
            ? { debug: { route: req.originalUrl, method: req.method } }
            : {}),
        });
      }

      // Replace with sanitized validated data
      (req as any)[property] = value;
      next();
    } catch (err: any) {
      logger.error(`[VALIDATION ERROR] ${err.message}`, {
        stack: err.stack,
        route: req.originalUrl,
      });
      return res.status(500).json({
        success: false,
        code: "INTERNAL_VALIDATION_ERROR",
        message: "Internal validation error occurred",
      });
    }
  };

/**
 * 🌐 Optional i18n message formatter (basic)
 * Can be extended later with real translation JSONs.
 */
function localizeMessage(msg: string, locale: string): string {
  if (locale === "hi") {
    return msg
      .replace(/is required/, "अनिवार्य है")
      .replace(/must be a/, "एक मान्य प्रकार होना चाहिए")
      .replace(/fails to match the required pattern/, "अनिवार्य पैटर्न से मेल नहीं खाता");
  }
  return msg;
}