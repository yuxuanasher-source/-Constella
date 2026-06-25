import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { sendNotification } from "@/lib/notify/notify";

import {
  getStreamerIdForUser,
  SupabaseLiveOperationsRepository,
} from "./live-operations-repository";

export type LiveOperationsRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseLiveOperationsRepository;
  audit: typeof writeAuditLog;
  notify: typeof sendNotification;
};

export async function getLiveOperationsRouteContext(): Promise<LiveOperationsRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }

  return {
    supabase,
    auth,
    repo: new SupabaseLiveOperationsRepository(supabase),
    audit: writeAuditLog,
    notify: sendNotification,
  };
}

export async function actorFromContext(
  context: LiveOperationsRouteContext,
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

export function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
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

  const message = messageFromUnknownError(error);
  if (message) {
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}

function messageFromUnknownError(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

export class RouteError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
