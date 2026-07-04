import { NextResponse } from "next/server";

import { enrichAgentOutputWithLlm } from "@/features/ai/agent-llm-enrichment";
import { validateAgentOutput } from "@/features/ai/agent-output-contract";
import { aiBriefRequestSchema } from "@/features/ai/agent-request-schemas";
import { runCastingAdviceAgent } from "@/features/ai/casting-advice-agent";
import { appendDataGapCaveats } from "@/features/ai/data-gaps";
import { runPricingTradeoffAgent } from "@/features/ai/pricing-tradeoff-agent";
import { loadCastingCandidates } from "@/features/streamers/casting-candidate-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

// 信任根收敛(方案 WP1):
// - pricing 是 what-if 计算器,参数是合法用户假设,过 schema 校验即可;
// - casting 的 matching 是筛选条件(用户输入),候选人快照必须服务端取数,
//   客户端 POST candidates 数组的旧契约已废弃。
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
        { error: "Only MCN staff can run AI casting briefs" },
        { status: 403 },
      );
    }

    const body = await parseJsonBody(request, aiBriefRequestSchema);

    if (body.kind === "pricing") {
      const { kind, ...pricingInput } = body;
      void kind;
      const result = runPricingTradeoffAgent(pricingInput);
      const { output: agentOutput, narrative } = await enrichAgentOutputWithLlm(
        {
          output: result.agentOutput,
          scene: "pricing_tradeoff",
          role: "你是 MCN 定价策略助手,基于项目定价与权衡事实给出定价诊断。",
          client: supabase,
          actor: auth,
        },
      );

      return NextResponse.json({
        ...result,
        agentOutput,
        narrative,
        validation: validateAgentOutput(agentOutput),
        dataGaps: [],
      });
    }

    const { candidates, dataGaps } = await loadCastingCandidates(supabase, {
      organizationId: auth.organizationId,
      requiredMinutes: body.matching.requiredMinutes,
      candidateIds: body.candidateIds,
    });
    const result = runCastingAdviceAgent({
      project: body.matching,
      candidates,
      maxRecommendations: body.maxRecommendations,
    });
    const { output: enriched, narrative } = await enrichAgentOutputWithLlm({
      output: result.agentOutput,
      scene: "casting_advice",
      role: "你是 MCN 选播策略助手,基于候选主播与项目匹配事实给出选播诊断。",
      client: supabase,
      actor: auth,
    });
    // 缺口 caveats 在 enrichment 之后追加,避免被模型生成的 caveats 覆盖。
    const agentOutput = appendDataGapCaveats(enriched, dataGaps);

    return NextResponse.json({
      ...result,
      agentOutput,
      narrative,
      validation: validateAgentOutput(agentOutput),
      dataGaps,
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
