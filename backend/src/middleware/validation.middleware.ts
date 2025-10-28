import { Request, Response, NextFunction } from "express";
import { ObjectSchema } from "joi";
import logger from "../logger";

/**
 * ✅ Universal validation middleware
 * Works with Joi or any schema validation library.
 *
 * Usage:
 *   router.post("/register", validateRequest(authRegisterSchema), controller.register);
 */
export const validateRequest =
  (schema: ObjectSchema, property: "body" | "query" | "params" = "body") =>
  (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // collect all errors
      allowUnknown: false, // reject unknown fields
      stripUnknown: true, // remove unexpected keys
    });

    if (error) {
      const details = error.details.map((d) => d.message.replace(/["]/g, ""));
      logger.warn(
        `⚠️ Validation failed for ${req.method} ${req.originalUrl}: ${details.join(", ")}`
      );
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors: details,
      });
      return;
    }

    // Attach sanitized data back to request
    req[property] = value;
    next();
  };

/**
 * 🧩 Example:
 *
 * import Joi from "joi";
 * const registerSchema = Joi.object({
 *   username: Joi.string().min(3).max(30).required(),
 *   password: Joi.string().min(6).required(),
 *   email: Joi.string().email().required()
 * });
 *
 * router.post("/register", validateRequest(registerSchema), registerController);
 */