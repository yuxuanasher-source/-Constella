import { NextResponse } from "next/server";

import {
  runBoundedAction,
  validateBoundedInput,
  type BoundedActionInput,
  type BoundedRuntimeClient,
} from "@/features/ai/bounded-runtime";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

// L3 受限执行入口：AI 触发的「异常工单 / 通知」经确认网关裁决。
// 可逆低风险 → 执行（写真表 + 审计）；需人工确认 / L4 → 落 ai_drafts(pending)。
// 即便提案被注入/越权，最多停在草稿层，碰不到不可逆动作。
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
        { error: "Only MCN staff can run bounded AI actions" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const input: BoundedActionInput = {
      actionType: body?.actionType,
      isHighRisk: Boolean(body?.isHighRisk),
      recipientRole: body?.recipientRole ?? null,
      recipientUserId: body?.recipientUserId ?? null,
      notificationType: body?.notificationType ?? null,
      title: String(body?.title ?? ""),
      content: String(body?.content ?? ""),
      taskId: body?.taskId ?? null,
    };

    const invalid = validateBoundedInput(input);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const outcome = await runBoundedAction(
      supabase as unknown as BoundedRuntimeClient,
      {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      input,
    );

    return NextResponse.json({
      outcome: outcome.outcome,
      decision: outcome.decision,
      ref: "ref" in outcome ? outcome.ref : null,
      result: "result" in outcome ? outcome.result : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
