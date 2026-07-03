import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { sendNotification } from "@/lib/notify/notify";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";

import { SupabaseStreamerLifecycleRepository } from "./streamer-lifecycle-repository";

export type StreamerLifecycleRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseStreamerLifecycleRepository;
  audit: typeof writeAuditLog;
  notify: typeof sendNotification;
};

export async function getStreamerLifecycleRouteContext(): Promise<StreamerLifecycleRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }

  return {
    supabase,
    auth,
    repo: new SupabaseStreamerLifecycleRepository(supabase),
    audit: writeAuditLog,
    notify: sendNotification,
  };
}

export async function actorFromContext(
  context: StreamerLifecycleRouteContext,
  includeStreamerId = false,
) {
  return {
    userId: context.auth.userId,
    name: context.auth.name,
    role: context.auth.role,
    organizationId: context.auth.organizationId,
    streamerId: includeStreamerId
      ? await getStreamerIdForUser(
          context.supabase,
          context.auth.userId,
          context.auth.organizationId,
        )
      : null,
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
