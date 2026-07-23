import { NextResponse } from "next/server";

import {
  HERMES_READ_ENDPOINTS,
  authorizeAndExecuteHermesReadTool,
  authenticateHermesReadRequest,
  hermesReadError,
  type HermesReadDbClient,
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
    return json(
      hermesReadError(auth.actor.invocationId, "internal_error"),
      503,
    );
  }

  const result = await authorizeAndExecuteHermesReadTool(
    client as unknown as HermesReadDbClient,
    auth.actor,
    toolName,
    filters,
  );
  return json(result.envelope, result.status);
}

function json(body: unknown, status: number): Response {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
