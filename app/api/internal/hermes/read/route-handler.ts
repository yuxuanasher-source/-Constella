import { NextResponse } from "next/server";

import {
  HERMES_READ_ENDPOINTS,
  authenticateHermesReadRequest,
  executeHermesReadTool,
  hermesReadError,
  hermesReadSuccess,
  type HermesReadDbClient,
  type HermesReadErrorCode,
  type HermesReadToolName,
} from "@/features/ai/hermes/read-api";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function handleHermesReadRoute(
  request: Request,
  toolName: HermesReadToolName,
): Promise<Response> {
  const spec = HERMES_READ_ENDPOINTS[toolName];
  const auth = await authenticateHermesReadRequest(request, spec);
  if (!auth.ok) {
    return json(auth.envelope, auth.status);
  }

  const filters = await request.json().catch(() => null);
  const client = createSupabaseAdminClient();
  if (!client) {
    return json(hermesReadError(auth.actor.invocationId, "internal_error"), 503);
  }

  const result = await executeHermesReadTool(
    client as unknown as HermesReadDbClient,
    auth.actor,
    toolName,
    filters,
  );
  if (typeof result === "string") {
    return json(
      hermesReadError(auth.actor.invocationId, result),
      statusForReadError(result),
    );
  }
  return json(hermesReadSuccess(auth.actor, result), 200);
}

function json(body: unknown, status: number): Response {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusForReadError(code: HermesReadErrorCode): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "permission_denied":
      return 403;
    case "not_found":
      return 404;
    case "invalid_request":
      return 400;
    case "rate_limited":
      return 429;
    case "upstream_unavailable":
      return 503;
    case "internal_error":
      return 500;
  }
}
