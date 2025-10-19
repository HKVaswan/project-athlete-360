// src/types/index.d.ts
import { Request } from "express";

export type UserRole = "admin" | "coach" | "athlete";

export interface JwtPayload {
  id: string;
  username: string;
  role: UserRole;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

// Common API response format
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

// Optional helper types
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface SortQuery {
  sortBy?: string;
  order?: "asc" | "desc";
}
