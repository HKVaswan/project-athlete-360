// src/types/index.d.ts
import { Request } from "express";

// ───────────────────────────────
// Common role types
export type UserRole = "admin" | "coach" | "athlete";

// ───────────────────────────────
// JWT Payload structure
export interface JwtPayload {
  id: string;
  username: string;
  role: UserRole;
  email?: string;
}

// ───────────────────────────────
// Authenticated request type
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

// ✅ Alias for backward compatibility
export type AuthRequest = AuthenticatedRequest;

// ───────────────────────────────
// Common API response format
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

// ───────────────────────────────
// Optional query helper types
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface SortQuery {
  sortBy?: string;
  order?: "asc" | "desc";
}

// ───────────────────────────────
// Global Express augmentation
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}