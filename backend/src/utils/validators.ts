// src/utils/validators.ts
/**
 * Enterprise-grade validation utility using Zod.
 * ------------------------------------------------------------
 *  - Centralized, consistent input validation across API.
 *  - Automatically integrates with TypeScript types.
 *  - Includes reusable field-level validators (email, password, code, etc.).
 *  - Supports safe parsing and unified error formatting.
 */

import { z, ZodError, ZodSchema } from "zod";

/**
 * Reusable field validators
 * (Keep all base field rules centralized for consistency)
 */
export const FieldValidators = {
  id: z.string().uuid("Invalid ID format."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long.")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
    .regex(/[0-9]/, "Password must contain at least one number.")
    .regex(/[@$!%*?&]/, "Password must contain at least one special character."),
  name: z
    .string()
    .trim()
    .min(2, "Name must have at least 2 characters.")
    .max(100, "Name too long."),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9\-]+$/, "Invalid code format."),
  date: z.coerce.date({ invalid_type_error: "Invalid date." }),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{10,15}$/, "Phone number must be 10–15 digits."),
  boolean: z.coerce.boolean().optional(),
};

/**
 * Helper: Unified error formatter
 * Converts Zod errors into clean JSON for API responses.
 */
export const formatZodError = (error: ZodError) => {
  const formatted = error.errors.map((err) => ({
    path: err.path.join("."),
    message: err.message,
  }));
  return { success: false, errors: formatted };
};

/**
 * Helper: Safe parse wrapper
 * - Tries to parse with schema
 * - Returns { success, data, errors } for consistency
 */
export const safeParse = <T>(schema: ZodSchema<T>, data: unknown) => {
  try {
    const result = schema.safeParse(data);
    if (!result.success) {
      return { success: false, errors: formatZodError(result.error), data: null };
    }
    return { success: true, data: result.data, errors: null };
  } catch (err) {
    return {
      success: false,
      errors: [{ message: "Unexpected validation error." }],
      data: null,
    };
  }
};

/**
 * Common schemas (reused across multiple routes)
 */
export const Schemas = {
  registerUser: z.object({
    email: FieldValidators.email,
    password: FieldValidators.password,
    name: FieldValidators.name,
    role: z.enum(["athlete", "coach", "admin"]),
    institutionCode: FieldValidators.code.optional(),
  }),

  loginUser: z.object({
    email: FieldValidators.email,
    password: z.string().min(1, "Password is required."),
  }),

  createInstitution: z.object({
    name: FieldValidators.name,
    address: z.string().optional(),
    contactEmail: FieldValidators.email.optional(),
    contactNumber: FieldValidators.phone.optional(),
    adminId: FieldValidators.id.optional(),
  }),

  createCompetition: z.object({
    name: FieldValidators.name,
    location: z.string().optional(),
    startDate: FieldValidators.date,
    endDate: FieldValidators.date.optional(),
    institutionId: FieldValidators.id.optional(),
  }),
};

/**
 * Example usage in middleware:
 *   import { validate } from "../middleware/validation.middleware";
 *   router.post("/register", validate(Schemas.registerUser), controller.register);
 */

export default { FieldValidators, Schemas, safeParse, formatZodError };