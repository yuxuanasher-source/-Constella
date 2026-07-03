import { NextResponse } from "next/server";

import { runAiToolQuery, type AiToolResult } from "@/features/ai/ai-tool-layer";
import { enrichAgentOutputWithLlm } from "@/features/ai/agent-llm-enrichment";
import { validateAgentOutput } from "@/features/ai/agent-output-contract";
import type { AgentOutput } from "@/features/ai/contracts";
import {
  DEFAULT_XINGYAO_RISK_WEIGHTS,
  type XingyaoRiskWeights,
} from "@/features/ai/xingyao-risk-radar";
import {
  loadXingyaoFeatureStore,
  type XingyaoSnapshotClient,
} from "@/features/ai/xingyao-snapshot-loader";
import {
  loadXingyaoRiskWeights,
  type XingyaoWeightRepositoryClient,
} from "@/features/ai/xingyao-weight-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

const XINGYAO_SCENE = "xingyao_org_diagnosis";
const XINGYAO_ROLE =
  "你是经营舱的星耀 AI 助手，负责组织级业务诊断：定位经营卡点、归因到具体主播/账号/时段，并给出前瞻风险预警。";

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
        { error: "Only MCN staff can run xingyao diagnosis" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { question?: unknown };
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { error: "Xingyao diagnosis question is required" },
        { status: 400 },
      );
    }

    // 权重带组织级校准覆盖；读取失败时退回默认模型，不阻断诊断。
    let weights: XingyaoRiskWeights = DEFAULT_XINGYAO_RISK_WEIGHTS;
    try {
      weights = await loadXingyaoRiskWeights(
        supabase as unknown as XingyaoWeightRepositoryClient,
        auth.organizationId,
      );
    } catch {
      weights = DEFAULT_XINGYAO_RISK_WEIGHTS;
    }

    const store = await loadXingyaoFeatureStore({
      client: supabase as unknown as XingyaoSnapshotClient,
      organizationId: auth.organizationId,
    });

    const result: AiToolResult = await runAiToolQuery({
      client: supabase,
      actor: {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      toolName: "xingyao_org_diagnosis",
      input: { question, store, weights },
    });

    const deterministicOutput = result.output.agentOutput as AgentOutput;
    const agentOutput = await enrichAgentOutputWithLlm({
      output: deterministicOutput,
      scene: XINGYAO_SCENE,
      role: XINGYAO_ROLE,
      contextLines: [`用户问题：${question}`],
      client: supabase,
      actor: auth,
    });

    return NextResponse.json({
      result: {
        toolName: result.toolName,
        invocationId: result.invocationId,
        mode: result.mode,
        answer: result.answer,
      },
      intent: result.output.intent,
      entity: result.output.entity,
      report: result.output.report,
      coverage: store.coverage,
      missingData: store.missingData,
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
