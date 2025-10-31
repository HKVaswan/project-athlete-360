/**
 * src/types/global.d.ts
 * ----------------------------------------------------------------------
 * Global Declarations for the Project Athlete 360 Backend
 *
 * Purpose:
 *  - Makes all custom types globally available across controllers,
 *    middleware, and services (no need for repetitive imports).
 *  - Extends Express Request with strong typing for authentication layers.
 * ----------------------------------------------------------------------
 */

import type { SuperAdminUser, SuperAdminRequest } from "./superAdmin.d";

declare global {
  namespace Express {
    /**
     * Extends the default Request object to support user roles,
     * including athletes, admins, and super admins.
     */
    interface Request {
      user?: {
        id: string;
        username: string;
        email?: string;
        role: "athlete" | "coach" | "admin" | "super_admin";
        impersonatedBy?: string;
        sessionVersion?: number;
      };
      isImpersonation?: boolean;
    }
  }

  // Re-export Super Admin-related global types
  type GlobalSuperAdminUser = SuperAdminUser;
  type GlobalSuperAdminRequest = SuperAdminRequest;
}

// Ensure this file is treated as a module
export {};