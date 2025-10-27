// src/middleware/validation.middleware.ts
import { Request, Response, NextFunction } from "express";
import Joi, { ObjectSchema } from "joi";
import logger from "../logger";

/**
 * 🧩 validateRequest
 * Universal middleware to validate incoming request data using Joi schema.
 * 
 * @param schema Joi schema to validate against
 * @param property request property to validate (default: "body")
 * 
 * Usage:
 * router.post("/", validateRequest(userSchema), controllerFunction);
 */
export const validateRequest = (
  schema: ObjectSchema,
  property: "body" | "query" | "params" = "body"
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error, value } = schema.validate(req[property], {
        abortEarly: false, // show all errors
        allowUnknown: false, // disallow unknown fields
        stripUnknown: true, // remove unexpected keys
      });

      if (error) {
        const details = error.details.map((d) => d.message);
        logger.warn(`[VALIDATION] Invalid ${property}: ${details.join(", ")}`);
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: details,
        });
      }

      // Replace request data with validated & sanitized version
      (req as any)[property] = value;
      next();
    } catch (err) {
      logger.error(`[VALIDATION] Unexpected error: ${(err as Error).message}`);
      res.status(500).json({
        success: false,
        message: "Internal validation error",
      });
    }
  };
};

/**
 * 🧱 Example: Common Schemas (can be imported anywhere)
 * You can also split these into a separate `validationSchemas.ts` later.
 */
export const Schemas = {
  registerUser: Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string().min(6).required(),
    name: Joi.string().max(100).required(),
    email: Joi.string().email().optional(),
    dob: Joi.date().optional(),
    sport: Joi.string().optional(),
    gender: Joi.string().valid("male", "female", "other").optional(),
    contact_info: Joi.string().optional(),
    institutionCode: Joi.string().optional(),
    coachCode: Joi.string().optional(),
    role: Joi.string().valid("admin", "coach", "athlete").optional(),
  }),

  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required(),
  }),

  institution: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    address: Joi.string().optional(),
    contactEmail: Joi.string().email().optional(),
    contactNumber: Joi.string().optional(),
  }),

  message: Joi.object({
    receiverId: Joi.string().uuid().required(),
    title: Joi.string().max(150).required(),
    content: Joi.string().max(2000).required(),
    attachments: Joi.array().items(Joi.string().uri()).optional(),
  }),
};