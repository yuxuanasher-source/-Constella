import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { sendNotification } from "@/lib/notify/notify";

import { SupabaseSettlementRepository } from "./settlement-repository";

export type SettlementRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseSettlementRepository;
  audit: typeof writeAuditLog;
  notify: typeof sendNotification;
};

export async function getSettlementRouteContext(): Promise<SettlementRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }

  return {
    supabase,
    auth,
    repo: new SupabaseSettlementRepository(supabase),
    audit: writeAuditLog,
    notify: sendNotification,
  };
}

export function settlementActorFromContext(context: SettlementRouteContext) {
  return {
    userId: context.auth.userId,
    name: context.auth.name,
    role: context.auth.role,
    organizationId: context.auth.organizationId,
  };
}

export async function readJsonBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = optionalString(body, key);
  if (!value) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function requiredNumber(
  body: Record<string, unknown>,
  key: string,
): number {
  const value = optionalNumber(body, key);
  if (value === undefined) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

export function requiredQueryParam(url: string, key: string): string {
  const value = new URL(url).searchParams.get(key)?.trim();
  if (!value) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Validate ids up front so a malformed value (e.g. a project name typed into a
// project-id field) returns a clear 400 instead of reaching Postgres and
// surfacing as an opaque "invalid input syntax for type uuid" failure that the
// error handler can only report as a generic 500.
export function requiredUuid(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = requiredString(body, key);
  if (!isUuid(value)) {
    throw new RouteError(`${key} must be a valid UUID`, 400);
  }

  return value;
}

export function requiredUuidQueryParam(url: string, key: string): string {
  const value = requiredQueryParam(url, key);
  if (!isUuid(value)) {
    throw new RouteError(`${key} must be a valid UUID`, 400);
  }

  return value;
}

type PostgrestErrorLike = {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

// Supabase surfaces database failures as PostgrestError objects (which, in some
// versions, are plain objects rather than Error instances). Detect them so they
// are mapped to a meaningful status with their message preserved, instead of
// collapsing to a generic "Unexpected error" 500 that hides the cause.
function isPostgrestError(error: unknown): error is PostgrestErrorLike {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" && typeof candidate.message === "string"
  );
}

export function jsonError(error: unknown) {
  if (error instanceof RouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (isPostgrestError(error)) {
    // SQLSTATE class 22 (data exception, e.g. invalid uuid/enum text) and class
    // 23 (integrity constraint violation) are caused by bad client input, so
    // report them as 400 with the database message. Anything else is an
    // unexpected server/DB fault — return 500 without leaking internals.
    const isClientError =
      error.code.startsWith("22") || error.code.startsWith("23");
    return NextResponse.json(
      { error: isClientError ? error.message : "Database error" },
      { status: isClientError ? 400 : 500 },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }

  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}

export class RouteError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
