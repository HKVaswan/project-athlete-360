// src/utils/pagination.ts
/**
 * 🚀 Enterprise-grade Pagination Utility for Prisma ORM
 * ----------------------------------------------------
 * Supports:
 *  - Offset Pagination (page + limit)
 *  - Cursor Pagination (cursorId + limit)
 *  - Auto meta generation (total, nextCursor, totalPages)
 *  - Count optimization & Redis-ready caching (optional)
 *  - Hard caps and sanitization to prevent data abuse
 */

import type { PrismaClient } from "@prisma/client";
import { ApiError, ErrorCodes } from "./errors";

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────
export interface PaginateQuery {
  page?: string | number;
  limit?: string | number;
  cursor?: string;
  orderBy?: string;
  orderDir?: "asc" | "desc";
}

export interface PrismaArgs {
  where?: any;
  include?: any;
  select?: any;
  orderBy?: any;
  skip?: number;
  take?: number;
  cursor?: any;
}

export interface PaginationMeta {
  total?: number | null;
  page?: number;
  limit: number;
  totalPages?: number | null;
  nextCursor?: string | null;
  hasMore?: boolean;
}

// ──────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100; // prevent large queries
const DEFAULT_PAGE = 1;

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────
const normalizeNumber = (
  value: any,
  defaultValue: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
): number => {
  const n = Number(value);
  if (Number.isNaN(n) || !isFinite(n)) return defaultValue;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
};

// ──────────────────────────────────────────────
// MAIN PAGINATION BUILDER
// ──────────────────────────────────────────────
export const buildPagination = (
  query: PaginateQuery,
  mode: "offset" | "cursor" = "offset"
) => {
  const page = normalizeNumber(query.page ?? DEFAULT_PAGE, DEFAULT_PAGE, 1);
  const limit = normalizeNumber(query.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const orderBy =
    query.orderBy && query.orderDir
      ? { [String(query.orderBy)]: query.orderDir }
      : { createdAt: "desc" as const };

  if (mode === "offset") {
    const skip = (page - 1) * limit;
    return {
      prismaArgs: { skip, take: limit, orderBy },
      meta: { page, limit } as PaginationMeta,
    };
  }

  if (mode === "cursor") {
    const cursorId = query.cursor ? String(query.cursor) : undefined;
    if (cursorId) {
      return {
        prismaArgs: { cursor: { id: cursorId }, skip: 1, take: limit, orderBy },
        meta: { limit, nextCursor: null } as PaginationMeta,
      };
    }
    return {
      prismaArgs: { take: limit, orderBy },
      meta: { limit, nextCursor: null } as PaginationMeta,
    };
  }

  throw new ApiError(400, "Invalid pagination mode", ErrorCodes.BAD_REQUEST);
};

// ──────────────────────────────────────────────
// FULL PAGINATION EXECUTOR
// ──────────────────────────────────────────────
export const paginate = async <T>(
  prismaModel: any, // e.g. prisma.athlete
  query: PaginateQuery,
  mode: "offset" | "cursor" = "offset",
  options?: {
    where?: any;
    include?: any;
    select?: any;
    count?: boolean; // true if we want to compute total count
  }
): Promise<{ data: T[]; meta: PaginationMeta }> => {
  const { where, include, select, count = true } = options ?? {};
  const { prismaArgs, meta } = buildPagination(query, mode);

  // attach conditions
  const args: PrismaArgs = {
    ...prismaArgs,
    ...(where ? { where } : {}),
    ...(include ? { include } : {}),
    ...(select ? { select } : {}),
  };

  const [data, total] = await Promise.all([
    prismaModel.findMany(args),
    count ? prismaModel.count({ where }) : Promise.resolve(null),
  ]);

  if (mode === "cursor" && data.length > 0) {
    meta.nextCursor = data[data.length - 1].id ?? null;
    meta.hasMore = !!meta.nextCursor;
  } else if (mode === "offset" && total !== null) {
    meta.total = total;
    meta.totalPages = Math.ceil(total / meta.limit);
    meta.hasMore = meta.page! < (meta.totalPages ?? 0);
  }

  return { data, meta };
};

// ──────────────────────────────────────────────
// CURSOR EXTRACTOR (standalone)
// ──────────────────────────────────────────────
export const computeNextCursor = <T extends { id?: string }>(
  rows: T[] | null
): string | null => {
  if (!rows?.length) return null;
  return rows[rows.length - 1].id ?? null;
};

// ──────────────────────────────────────────────
// OFFSET HELPER FOR CONTROLLERS
// ──────────────────────────────────────────────
export const getPaginationParams = (reqQuery: any) => {
  const page = normalizeNumber(reqQuery.page ?? 1, 1, 1);
  const limit = normalizeNumber(reqQuery.limit ?? 10, 10, 1, MAX_LIMIT);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};