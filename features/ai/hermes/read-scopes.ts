import type { AuthContext } from "@/lib/auth/context";

import {
  HERMES_ROLES,
  XINGYAO_READ_SCOPES,
  canonicalUuidSchema,
  type XingyaoReadScope,
} from "./contracts";

const NO_READ_SCOPES = Object.freeze([]) as readonly XingyaoReadScope[];
const FINANCE_READ_SCOPES = Object.freeze([
  "context.read",
  "projects.search",
  "projects.summary",
  "knowledge.search",
  "settlements.summary",
] as const satisfies readonly XingyaoReadScope[]);

export function isCompleteHermesAuthContext(
  value: unknown,
): value is AuthContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const auth = value as Partial<Record<keyof AuthContext, unknown>>;
  return (
    canonicalUuidSchema.safeParse(auth.userId).success &&
    canonicalUuidSchema.safeParse(auth.organizationId).success &&
    typeof auth.email === "string" &&
    auth.email.trim().length > 0 &&
    typeof auth.name === "string" &&
    auth.name.trim().length > 0 &&
    typeof auth.organizationName === "string" &&
    auth.organizationName.trim().length > 0 &&
    typeof auth.role === "string" &&
    HERMES_ROLES.includes(auth.role as (typeof HERMES_ROLES)[number])
  );
}

export function resolveHermesReadScopes(
  auth: AuthContext,
): readonly XingyaoReadScope[] {
  if (!isCompleteHermesAuthContext(auth)) {
    return NO_READ_SCOPES;
  }

  switch (auth.role) {
    case "finance":
      return FINANCE_READ_SCOPES;
    case "owner":
    case "ops_manager":
    case "operator_business":
    case "streamer":
      return XINGYAO_READ_SCOPES;
    default:
      return NO_READ_SCOPES;
  }
}
