import { NextResponse } from "next/server";

import { enrichAgentOutputWithLlm } from "@/features/ai/agent-llm-enrichment";
import { validateAgentOutput } from "@/features/ai/agent-output-contract";
import {
  copilotRequestSchema,
  type CopilotRequest,
} from "@/features/ai/agent-request-schemas";
import { appendDataGapCaveats } from "@/features/ai/data-gaps";
import {
  runM10CopilotAgent,
  type M10CopilotInput,
} from "@/features/ai/m10-copilot-agent";
import { loadCastingCandidates } from "@/features/streamers/casting-candidate-loader";
import { loadProjectReviewInput } from "@/features/war-room/project-review-loader";
import { getAuthContext } from "@/lib/auth/context";
import type { AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";
import type { SupabaseClient } from "@supabase/supabase-js";

const COPILOT_SCENE_ROLE = {
  pricing_tradeoff: {
    scene: "pricing_tradeoff",
    role: "你是 MCN 定价策略助手,基于项目定价与权衡事实给出定价诊断。",
  },
  casting_advice: {
    scene: "casting_advice",
    role: "你是 MCN 选播策略助手,基于候选主播与项目匹配事实给出选播诊断。",
  },
  project_review: {
    scene: "business_analysis",
    role: "你是 MCN 资深经营分析助手,基于项目经营事实为该项目给出经营诊断。",
  },
  script_optimization: {
    scene: "script_optimization",
    role: "你是直播话术优化助手,基于脚本与直播事实给出话术优化诊断。",
  },
} as const;

// 信任根收敛(方案 WP1):copilot 只接收 intent + ID/用户参数,分发前按
// intent 走与专属路由完全相同的 loader 组装事实(project_review / casting
// 服务端取数;pricing / script 是合法用户输入),保证两条入口口径一致。
// runM10CopilotAgent 保持纯函数不变。
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
        { error: "Only MCN staff can run M10 copilot" },
        { status: 403 },
      );
    }

    const body = await parseJsonBody(request, copilotRequestSchema);
    const resolved = await resolveCopilotInput(supabase, auth, body);
    if (!resolved) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const result = runM10CopilotAgent(resolved.input);

    // The copilot dispatches to a sub-agent; enrich that agent's output with
    // the model narrative using the same scene as the dedicated routes.
    const { scene, role } = COPILOT_SCENE_ROLE[result.intent];
    const { output: enriched, narrative } = await enrichAgentOutputWithLlm({
      output: result.agentOutput,
      scene,
      role,
      client: supabase,
      actor: auth,
    });
    // 缺口 caveats 在 enrichment 之后追加,避免被模型生成的 caveats 覆盖。
    const agentOutput = appendDataGapCaveats(enriched, resolved.dataGaps);

    return NextResponse.json({
      ...result,
      agentOutput,
      narrative,
      validation: validateAgentOutput(agentOutput),
      dataGaps: resolved.dataGaps,
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

async function resolveCopilotInput(
  supabase: SupabaseClient,
  auth: AuthContext,
  body: CopilotRequest,
): Promise<{ input: M10CopilotInput; dataGaps: string[] } | null> {
  if (body.intent === "project_review") {
    const loaded = await loadProjectReviewInput(supabase, {
      organizationId: auth.organizationId,
      projectId: body.payload.projectId,
      periodStart: body.payload.periodStart,
      periodEnd: body.payload.periodEnd,
      targetMarginBps: body.payload.targetMarginBps,
    });
    if (!loaded) {
      return null;
    }
    return {
      input: { intent: "project_review", payload: loaded.input },
      dataGaps: loaded.dataGaps,
    };
  }

  if (body.intent === "casting_advice") {
    const { candidates, dataGaps } = await loadCastingCandidates(supabase, {
      organizationId: auth.organizationId,
      requiredMinutes: body.payload.matching.requiredMinutes,
      candidateIds: body.payload.candidateIds,
    });
    return {
      input: {
        intent: "casting_advice",
        payload: {
          project: body.payload.matching,
          candidates,
          maxRecommendations: body.payload.maxRecommendations,
        },
      },
      dataGaps,
    };
  }

  if (body.intent === "pricing_tradeoff") {
    return {
      input: { intent: "pricing_tradeoff", payload: body.payload },
      dataGaps: [],
    };
  }

  return {
    input: { intent: "script_optimization", payload: body.payload },
    dataGaps: [],
  };
}
