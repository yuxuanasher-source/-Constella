import { z } from "zod";

import { canonicalUuidSchema } from "./contracts";

export const HERMES_PAGE_TYPES = Object.freeze([
  "dashboard",
  "projects",
  "project",
  "streamer_profile",
  "live_reports",
  "recording_reviews",
  "knowledge",
  "settlements",
] as const);

const CLIENT_ACTOR_FIELDS = new Set([
  "iss",
  "aud",
  "sub",
  "userid",
  "organizationid",
  "role",
  "scopes",
  "readscopes",
  "allowedreadscopes",
  "enabledskillversions",
  "skillgrants",
  "skillgrantshash",
  "profileversion",
  "actorfingerprint",
  "actorassertion",
  "conversationid",
  "invocationid",
  "jti",
]);

const pageContextInputSchema = z.strictObject({
  pageType: z.enum(HERMES_PAGE_TYPES),
  objectIds: z
    .array(canonicalUuidSchema)
    .max(20)
    .superRefine((objectIds, context) => {
      if (new Set(objectIds).size !== objectIds.length) {
        context.addIssue({
          code: "custom",
          message: "objectIds must not contain duplicates",
        });
      }
    }),
});

export type HermesPageType = (typeof HERMES_PAGE_TYPES)[number];
export type SanitizedHermesPageContext = Readonly<{
  pageType: HermesPageType;
  objectIds: readonly string[];
}>;

export class HermesPageContextError extends TypeError {
  readonly code = "hermes_page_context_invalid";

  constructor() {
    super("Hermes page context is invalid");
    this.name = "HermesPageContextError";
  }
}

function normalizeFieldName(value: string): string {
  return value.replace(/[_-]/g, "").toLowerCase();
}

export function hasClientControlledActorFields(value: unknown): boolean {
  const seen = new Set<object>();
  const pending: unknown[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, entry] of Object.entries(current)) {
      if (CLIENT_ACTOR_FIELDS.has(normalizeFieldName(key))) {
        return true;
      }
      pending.push(entry);
    }
  }
  return false;
}

export function sanitizeHermesPageContext(
  value: unknown,
): SanitizedHermesPageContext {
  if (hasClientControlledActorFields(value)) {
    throw new HermesPageContextError();
  }
  const parsed = pageContextInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new HermesPageContextError();
  }
  const objectIds = Object.freeze([...parsed.data.objectIds].sort());
  return Object.freeze({
    pageType: parsed.data.pageType,
    objectIds,
  });
}
