/**
 * src/lib/core/apiResponse.ts
 * ------------------------------------------------------------
 * Enterprise-grade unified API response builder.
 *
 * Ensures all controllers and services return a consistent
 * response structure for easy client integration and debugging.
 * 
 * Key Features:
 *  - Consistent shape across success/failure
 *  - Built-in metadata support for pagination & context
 *  - Optional developer-safe debug mode (non-production only)
 */

import { config } from "../../config";
import { logger } from "../../logger";

export interface ApiResponseOptions<T> {
  message?: string;
  data?: T;
  meta?: Record<string, any>;
  debug?: any; // included only in non-production
}

/**
 * Standard success response structure
 */
export const successResponse = <T = any>({
  message = "Success",
  data,
  meta,
  debug,
}: ApiResponseOptions<T>) => {
  const response: any = {
    success: true,
    message,
  };

  if (data !== undefined) response.data = data;
  if (meta) response.meta = meta;

  // Only include debug info in non-production
  if (debug && config.env !== "production") {
    response.debug = debug;
    logger.debug("[API:DEBUG]", debug);
  }

  return response;
};

/**
 * Quick helper for paginated responses
 */
export const paginatedResponse = <T = any>(
  items: T[],
  meta: { total: number; page: number; limit: number; totalPages: number },
  message = "Data fetched successfully"
) =>
  successResponse({
    message,
    data: items,
    meta,
  });

/**
 * Quick helper for creation/update success
 */
export const operationSuccess = (message = "Operation completed successfully") =>
  successResponse({ message });

/**
 * Global API Response Middleware (optional for future)
 * ----------------------------------------------------
 * Can be attached to express res.locals for automatic
 * wrapping of all controller outputs.
 */
export const wrapResponse = (req: any, res: any, next: any) => {
  res.success = (data: any, message = "Success", meta?: any) => {
    res.json(successResponse({ data, message, meta }));
  };
  next();
};