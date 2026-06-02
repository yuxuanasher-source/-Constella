import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { sendNotification } from "@/lib/notify/notify";

import {
  getStreamerIdForUser,
  SupabaseApplicationRepository,
} from "./application-repository";

export type AdmissionRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseApplicationRepository;
  audit: typeof writeAuditLog;
  notify: typeof sendNotification;
};

export async function getAdmissionRouteContext(): Promise<AdmissionRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }

  return {
    supabase,
    auth,
    repo: new SupabaseApplicationRepository(supabase),
    audit: writeAuditLog,
    notify: sendNotification,
  };
}

export function actorFromContext(context: AdmissionRouteContext) {
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

export async function resolveStreamerId(
  context: AdmissionRouteContext,
  body: Record<string, unknown>,
): Promise<string> {
  const explicitStreamerId = optionalString(body, "streamerId");
  if (explicitStreamerId) {
    return explicitStreamerId;
  }

  const ownStreamerId = await getStreamerIdForUser(
    context.supabase,
    context.auth.userId,
  );
  if (!ownStreamerId) {
    throw new RouteError("Current user is not bound to a streamer", 400);
  }

  return ownStreamerId;
}

export function jsonError(error: unknown) {
  if (error instanceof RouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
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
