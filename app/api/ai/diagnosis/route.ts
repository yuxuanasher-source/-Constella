import { NextResponse } from "next/server";

import { runStreamerDiagnosisAgent } from "@/features/ai/streamer-diagnosis-agent";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    // The AI ledger tables (ai_invocations / ai_tool_invocations) only allow
    // MCN-staff inserts under RLS, but this tool is streamer-facing. Record the
    // append-only telemetry with the service client; the organization id is
    // taken from the authenticated context, not from the caller's input.
    const ledgerClient = createSupabaseAdminClient() ?? supabase;
    const result = await runStreamerDiagnosisAgent({
      client: ledgerClient,
      actor: auth,
      input: body,
    });

    return NextResponse.json({
      result: result.result,
      agentOutput: result.agentOutput,
      validation: result.validation,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
