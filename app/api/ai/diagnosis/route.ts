import { NextResponse } from "next/server";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import { withAuth } from "@/lib/http/route-handler";

export const POST = withAuth(async ({ supabase, auth, request }) => {
  const body = (await request.json()) as Record<string, unknown>;
  const result = await runAiToolQuery({
    client: supabase,
    actor: auth,
    toolName: "streamer_diagnosis",
    input: body,
  });

  return NextResponse.json({ result });
});
