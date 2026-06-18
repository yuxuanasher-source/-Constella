import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

import { SupabaseComplexCostRepository } from "./complex-cost-repository";

export type ComplexCostRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseComplexCostRepository;
  audit: typeof writeAuditLog;
};

export async function getComplexCostRouteContext(): Promise<ComplexCostRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }
  if (!isMcnStaff(auth.role)) {
    throw new RouteError("Only MCN staff can manage complex cost rules", 403);
  }

  return {
    supabase,
    auth,
    repo: new SupabaseComplexCostRepository(supabase),
    audit: writeAuditLog,
  };
}

export function complexCostActorFromContext(context: ComplexCostRouteContext) {
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

export function optionalRecord(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = body[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function arrayOfRecords(
  body: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const value = body[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

export function jsonError(error: unknown) {
  if (error instanceof RouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
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
