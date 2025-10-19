// src/utils/validators.ts
import Joi from "joi";

// ───────────────────────────────
// Auth validators
export const registerSchema = Joi.object({
  username: Joi.string().min(3).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().required(),
});

export const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
});

// ───────────────────────────────
// User profile validators
export const updateProfileSchema = Joi.object({
  name: Joi.string().optional(),
  email: Joi.string().email().optional(),
});

// ───────────────────────────────
// Session validators
export const sessionSchema = Joi.object({
  name: Joi.string().required(),
  coachId: Joi.string().required(),
  date: Joi.date().required(),
  duration: Joi.number().min(10).required(),
  notes: Joi.string().allow("").optional(),
});
