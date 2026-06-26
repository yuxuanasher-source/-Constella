/**
 * Defensive list bounds. List queries default to returning at most
 * DEFAULT_LIST_LIMIT rows so a missing filter can never trigger an unbounded
 * full-table scan. Callers may pass an explicit limit/offset (e.g. parsed from
 * `?limit`/`?offset`), clamped to MAX_LIST_LIMIT. The response shape stays a
 * plain array, so existing clients are unaffected.
 */
export const DEFAULT_LIST_LIMIT = 500;
export const MAX_LIST_LIMIT = 1000;

export type ListPagination = { limit?: number; offset?: number };

export type ResolvedListRange = {
  limit: number;
  offset: number;
  /** Inclusive start index for Supabase `.range()`. */
  from: number;
  /** Inclusive end index for Supabase `.range()`. */
  to: number;
};

export function resolveListRange(
  pagination?: ListPagination,
): ResolvedListRange {
  const rawLimit = pagination?.limit;
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT;

  const rawOffset = pagination?.offset;
  const offset =
    typeof rawOffset === "number" && Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.floor(rawOffset)
      : 0;

  return { limit, offset, from: offset, to: offset + limit - 1 };
}

export function parseListPagination(url: string): ListPagination {
  const params = new URL(url).searchParams;
  const pagination: ListPagination = {};

  const limit = Number(params.get("limit"));
  if (Number.isFinite(limit) && limit > 0) {
    pagination.limit = limit;
  }

  const offset = Number(params.get("offset"));
  if (Number.isFinite(offset) && offset > 0) {
    pagination.offset = offset;
  }

  return pagination;
}
