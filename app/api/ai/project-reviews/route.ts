import { NextResponse } from "next/server";

import { enrichAgentOutputWithLlm } from "@/features/ai/agent-llm-enrichment";
import { validateAgentOutput } from "@/features/ai/agent-output-contract";
import { runBusinessAnalysisAgent } from "@/features/ai/business-analysis-agent";
import type { ProjectReviewInput } from "@/features/war-room/project-review-report";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

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

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can run AI project reviews" },
        { status: 403 },
      );
    }

    const input = (await request.json()) as ProjectReviewInput;
    const result = runBusinessAnalysisAgent(input);
    const agentOutput = await enrichAgentOutputWithLlm({
      output: result.output,
      scene: "business_analysis",
      role: "你是 MCN 资深经营分析助手,基于项目经营事实为该项目给出经营诊断。",
      client: supabase,
      actor: auth,
    });

    return NextResponse.json({
      report: result.report,
      agentOutput,
      validation: validateAgentOutput(agentOutput),
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
