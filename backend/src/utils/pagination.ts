/**
 * src/utils/pagination.ts
 * -------------------------------------------------------
 * Utility for safe, consistent pagination handling.
 * Works for both page-based and cursor-based APIs.
 */

import { Prisma } from "@prisma/client";

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string | null;
}

export interface PaginationMeta {
  total?: number;
  page?: number;
  limit?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  nextCursor?: string | null;
}

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

/**
 * Normalize and sanitize incoming pagination params
 */
export const normalizePagination = (params: PaginationParams) => {
  let page = Math.max(1, Number(params.page) || 1);
  let limit = Math.min(Math.max(1, Number(params.limit) || DEFAULT_LIMIT), MAX_LIMIT);
  let cursor = params.cursor || null;
  return { page, limit, cursor };
};

/**
 * Build pagination metadata for response.
 * Works seamlessly for REST APIs.
 */
export const buildPaginationMeta = (
  total: number,
  page: number,
  limit: number
): PaginationMeta => {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

/**
 * Helper: Prisma-based cursor pagination generator.
 * Allows highly efficient pagination on large datasets.
 */
export const prismaCursorPagination = async <T>(
  prismaModel: any,
  args: Prisma.Prisma__Pick<Prisma.Args<any, any>, any>,
  params: PaginationParams
): Promise<{ data: T[]; meta: PaginationMeta }> => {
  const { cursor, limit = DEFAULT_LIMIT } = normalizePagination(params);

  const queryArgs: any = {
    ...args,
    take: limit + 1, // fetch one extra to check if there's next
    orderBy: args.orderBy || { id: "asc" },
  };

  if (cursor) {
    queryArgs.skip = 1;
    queryArgs.cursor = { id: cursor };
  }

  const items = await prismaModel.findMany(queryArgs);

  const hasNextPage = items.length > limit;
  const data = hasNextPage ? items.slice(0, -1) : items;
  const nextCursor = hasNextPage ? (data[data.length - 1] as any)?.id : null;

  return {
    data,
    meta: {
      limit,
      nextCursor,
      hasNextPage,
    },
  };
};