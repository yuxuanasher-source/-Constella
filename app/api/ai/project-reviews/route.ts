import { NextResponse } from "next/server";

import { enrichAgentOutputWithLlm } from "@/features/ai/agent-llm-enrichment";
import { validateAgentOutput } from "@/features/ai/agent-output-contract";
import { projectReviewRequestSchema } from "@/features/ai/agent-request-schemas";
import { runBusinessAnalysisAgent } from "@/features/ai/business-analysis-agent";
import { appendDataGapCaveats } from "@/features/ai/data-gaps";
import { loadProjectReviewInput } from "@/features/war-room/project-review-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

// 信任根收敛(方案 WP1):只接收 projectId + 期间 + 目标毛利率,复盘事实
// (财务、主播、证据统计)一律服务端在组织隔离下取数;客户端 POST 完整
// ProjectReviewInput 的旧契约已废弃(schema 校验直接 400)。
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

    const body = await parseJsonBody(request, projectReviewRequestSchema);
    const loaded = await loadProjectReviewInput(supabase, {
      organizationId: auth.organizationId,
      projectId: body.projectId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      targetMarginBps: body.targetMarginBps,
    });
    if (!loaded) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const result = runBusinessAnalysisAgent(loaded.input);
    const { output: enriched, narrative } = await enrichAgentOutputWithLlm({
      output: result.output,
      scene: "business_analysis",
      role: "你是 MCN 资深经营分析助手,基于项目经营事实为该项目给出经营诊断。",
      client: supabase,
      actor: auth,
    });
    // 缺口 caveats 在 enrichment 之后追加,避免被模型生成的 caveats 覆盖。
    const agentOutput = appendDataGapCaveats(enriched, loaded.dataGaps);

    return NextResponse.json({
      report: result.report,
      agentOutput,
      narrative,
      validation: validateAgentOutput(agentOutput),
      dataGaps: loaded.dataGaps,
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
