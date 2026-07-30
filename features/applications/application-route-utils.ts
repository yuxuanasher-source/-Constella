import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
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
    context.auth.organizationId,
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

  const serviceError = serviceErrorDetails(error);
  if (serviceError) {
    return NextResponse.json(
      {
        ...(serviceError.code ? { code: serviceError.code } : {}),
        error: serviceError.message,
      },
      { status: serviceError.statusCode },
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

function serviceErrorDetails(error: unknown): {
  code: string | null;
  message: string;
  statusCode: number;
} | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
  };
  if (
    typeof candidate.message !== "string" ||
    !candidate.message.trim() ||
    typeof candidate.statusCode !== "number" ||
    !Number.isInteger(candidate.statusCode) ||
    candidate.statusCode < 400 ||
    candidate.statusCode > 599
  ) {
    return null;
  }
  return {
    code:
      typeof candidate.code === "string" && candidate.code.trim()
        ? candidate.code
        : null,
    message: candidate.message,
    statusCode: candidate.statusCode,
  };
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
