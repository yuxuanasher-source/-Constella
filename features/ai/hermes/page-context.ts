import { hasExactKeys, isUuid } from "./contracts";

export const HERMES_PAGE_TYPES = [
  "global",
  "project",
  "streamer",
  "live_report",
  "finance_batch",
  "knowledge",
] as const;

export type HermesPageType = (typeof HERMES_PAGE_TYPES)[number];

export type HermesPageContext = {
  pageType: HermesPageType;
  objectIds: string[];
};

const PAGE_CONTEXT_KEYS = ["objectIds", "pageType"] as const;

export function sanitizeHermesPageContext(
  value: unknown,
): HermesPageContext | null {
  if (!isRecord(value) || !hasExactKeys(value, PAGE_CONTEXT_KEYS)) {
    return null;
  }
  if (!isHermesPageType(value.pageType)) {
    return null;
  }
  if (!Array.isArray(value.objectIds) || value.objectIds.length > 20) {
    return null;
  }

  const seen = new Set<string>();
  for (const id of value.objectIds) {
    if (!isUuid(id) || seen.has(id)) {
      return null;
    }
    seen.add(id);
  }

  return {
    pageType: value.pageType,
    objectIds: [...seen].sort(),
  };
}

function isHermesPageType(value: unknown): value is HermesPageType {
  return (
    typeof value === "string" &&
    HERMES_PAGE_TYPES.includes(value as HermesPageType)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
