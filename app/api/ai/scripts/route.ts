import { NextResponse } from "next/server";

import { enrichAgentOutputWithLlm } from "@/features/ai/agent-llm-enrichment";
import { validateAgentOutput } from "@/features/ai/agent-output-contract";
import { scriptOptimizationRequestSchema } from "@/features/ai/agent-request-schemas";
import { runScriptOptimizationAgent } from "@/features/ai/script-optimization-agent";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

type ScriptVersionClient = {
  from(table: "ai_script_versions"): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
  };
};

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
        { error: "Only MCN staff can create AI script drafts" },
        { status: 403 },
      );
    }

    // 脚本文本与反馈是被优化的用户素材(合法输入),但必须过 schema 校验。
    const input = await parseJsonBody(request, scriptOptimizationRequestSchema);
    const result = runScriptOptimizationAgent(input);
    const draft = result.scriptVersionDraft;
    const { error } = await (supabase as ScriptVersionClient)
      .from("ai_script_versions")
      .insert({
        organization_id: auth.organizationId,
        streamer_id: draft.streamerId,
        project_id: draft.projectId,
        script_key: draft.scriptKey,
        version: draft.version,
        status: "draft",
        content: draft.content,
        facts: result.agentOutput.facts,
        created_by: auth.userId,
      });

    if (error) {
      throw error;
    }

    const { output: agentOutput, narrative } = await enrichAgentOutputWithLlm({
      output: result.agentOutput,
      scene: "script_optimization",
      role: "你是直播话术优化助手,基于脚本与直播事实给出话术优化诊断。",
      client: supabase,
      actor: auth,
    });

    return NextResponse.json({
      scriptVersionDraft: draft,
      agentOutput,
      narrative,
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
