// src/utils/pagination.ts
/**
 * Enterprise-grade pagination helper for Prisma queries.
 *
 * Supports:
 *  - Offset pagination (page + limit) -> skip, take
 *  - Cursor pagination (cursorId + limit) -> cursor, skip: 1, take
 *  - Safe defaults and hard limits to avoid DoS/data floods
 *  - Utility to build meta: total, page, limit, totalPages, nextCursor
 *
 * Usage:
 *  const { prismaArgs, meta } = await paginate(req.query, ModelName, prismaClient);
 *  const items = await prisma.model.findMany(prismaArgs);
 *  return { data: items, meta };
 */

import { PrismaClient } from "@prisma/client";

export type PaginateQuery = {
  page?: string | number;
  limit?: string | number;
  cursor?: string; // cursor id for cursor pagination
  orderBy?: string; // optional order key
  orderDir?: "asc" | "desc";
};

export type PrismaFindArgs = {
  where?: any;
  include?: any;
  select?: any;
  orderBy?: any;
  skip?: number;
  take?: number;
  cursor?: any;
};

export type PaginationMeta = {
  total?: number | null; // optional (could be expensive)
  page?: number;
  limit: number;
  totalPages?: number | null;
  nextCursor?: string | null;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100; // hard cap to prevent heavy queries
const DEFAULT_PAGE = 1;

/**
 * Normalizes numeric query param into safe number range.
 */
const normalizeNumber = (value: any, defaultValue: number, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value);
  if (Number.isNaN(n) || !isFinite(n)) return defaultValue;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
};

/**
 * Build Prisma query args for offset pagination (page+limit)
 */
export const buildOffsetPagination = (query: PaginateQuery) => {
  const page = normalizeNumber(query.page ?? DEFAULT_PAGE, DEFAULT_PAGE, 1);
  const limit = normalizeNumber(query.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const skip = (page - 1) * limit;

  const orderBy =
    query.orderBy && query.orderDir
      ? { [String(query.orderBy)]: query.orderDir }
      : { createdAt: "desc" as const };

  return {
    prismaArgs: { skip, take: limit, orderBy },
    meta: { page, limit } as PaginationMeta,
  };
};

/**
 * Build Prisma query args for cursor pagination (cursor + limit)
 * Expects cursor to be a string id (UUID or numeric id) that the model uses as primary key.
 */
export const buildCursorPagination = (query: PaginateQuery) => {
  const limit = normalizeNumber(query.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const cursorId = query.cursor ? String(query.cursor) : undefined;

  const orderBy =
    query.orderBy && query.orderDir
      ? { [String(query.orderBy)]: query.orderDir }
      : { createdAt: "desc" as const };

  if (cursorId) {
    // Prisma cursor pagination pattern: { cursor: { id: cursorId }, skip: 1, take: limit }
    return {
      prismaArgs: { cursor: { id: cursorId }, skip: 1, take: limit, orderBy },
      meta: { limit, nextCursor: null } as PaginationMeta,
    };
  }

  // no cursor provided, behave like initial page
  return {
    prismaArgs: { take: limit, orderBy },
    meta: { limit, nextCursor: null } as PaginationMeta,
  };
};

/**
 * High-level paginate helper.
 *
 * - query: req.query typed shape (page, limit, cursor)
 * - mode: 'offset' | 'cursor'
 * - countFn (optional): a function to calculate total count (used for meta.total & totalPages)
 * - prisma: PrismaClient instance (only needed if you want to use count inside helper)
 *
 * Returns:
 *  { prismaArgs, meta } where prismaArgs is safe to pass into prisma.findMany(...)
 */
export const paginate = async (
  query: PaginateQuery,
  mode: "offset" | "cursor" = "offset",
  options?: {
    // optional function to compute total count: e.g. (where) => prisma.model.count({ where })
    countFn?: (where?: any) => Promise<number>;
    where?: any;
    prisma?: PrismaClient;
    includeTotal?: boolean; // if true and countFn provided, the helper will compute total & totalPages
  }
) => {
  const { countFn, where, prisma, includeTotal } = options ?? {};
  let prismaArgs: PrismaFindArgs;
  let meta: PaginationMeta;

  if (mode === "cursor") {
    const built = buildCursorPagination(query);
    prismaArgs = built.prismaArgs;
    meta = built.meta;
  } else {
    const built = buildOffsetPagination(query);
    prismaArgs = built.prismaArgs;
    meta = built.meta;
  }

  if (where) prismaArgs.where = where;

  // If the caller requested totals and provided a countFn, compute it
  if (includeTotal && typeof countFn === "function") {
    try {
      const total = await countFn(where);
      meta.total = total;
      if (mode === "offset") {
        meta.totalPages = Math.ceil(total / meta.limit);
      } else {
        meta.totalPages = null; // not meaningful for cursor
      }
    } catch (err) {
      // do not fail the request due to meta calculation — log and continue
      // consumer controllers should log
      meta.total = null;
      meta.totalPages = null;
    }
  }

  return { prismaArgs, meta };
};

/**
 * Helper to compute nextCursor from results (cursor pagination).
 *
 * Usage:
 *  const { prismaArgs, meta } = await paginate(query, 'cursor', { ... });
 *  const rows = await prisma.model.findMany(prismaArgs);
 *  if (rows.length > 0) meta.nextCursor = rows[rows.length - 1].id;
 */
export const computeNextCursor = <T extends { id?: string }>(rows: T[] | null) => {
  if (!rows || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return last.id ?? null;
};