import { NextResponse } from "next/server";

import { enrichAgentOutputWithLlm } from "@/features/ai/agent-llm-enrichment";
import { validateAgentOutput } from "@/features/ai/agent-output-contract";
import {
  runM10CopilotAgent,
  type M10CopilotInput,
} from "@/features/ai/m10-copilot-agent";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

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

    const input = (await request.json()) as M10CopilotInput;
    const result = runM10CopilotAgent(input);

    // The copilot dispatches to a sub-agent; enrich that agent's output with
    // the model narrative using the same scene as the dedicated routes.
    const { scene, role } = COPILOT_SCENE_ROLE[result.intent];
    const agentOutput = await enrichAgentOutputWithLlm({
      output: result.agentOutput,
      scene,
      role,
      client: supabase,
      actor: auth,
    });

    return NextResponse.json({
      ...result,
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
