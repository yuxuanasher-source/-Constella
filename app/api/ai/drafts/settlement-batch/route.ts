import { NextResponse } from "next/server";

import { createAiDraft, type DraftClient } from "@/features/ai/draft-repository";
import {
  buildSettlementBatchDraft,
  type SettlementPoolItem,
} from "@/features/ai/drafts";
import { listOpsSettlementPool } from "@/features/settlements/settlement-queries";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

// L2 草稿生成：从结算池（走 RLS）按项目×周期生成结算批次草稿，写 ai_drafts(pending)。
// 不影响主流程；正式批次仍须人工在草稿上确认（确认是 L4 人工动作，AI 不点）。
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
        { error: "Only MCN staff can create AI drafts" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const projectId =
      typeof body?.projectId === "string" && body.projectId ? body.projectId : null;
    const periodStart = String(body?.periodStart ?? "");
    const periodEnd = String(body?.periodEnd ?? "");
    const batchType = body?.batchType === "receivable" ? "receivable" : "payable";
    if (!periodStart || !periodEnd) {
      return NextResponse.json(
        { error: "periodStart and periodEnd are required" },
        { status: 400 },
      );
    }

    const reports = await listOpsSettlementPool(supabase, {
      organizationId: auth.organizationId,
      projectId,
      batchType,
      periodStart,
      periodEnd,
    });

    const items: SettlementPoolItem[] = reports.map((report) => ({
      id: report.id,
      projectId: report.projectId,
      projectName: report.projectName,
      streamerName: report.streamerName,
      evidenceLevel: report.evidenceLevel,
      timeSource: report.timeSource,
      payableCents: report.expectedAmount,
    }));

    const envelope = buildSettlementBatchDraft(items, {
      periodStart,
      periodEnd,
      batchType,
    });

    const created = await createAiDraft(supabase as unknown as DraftClient, {
      organizationId: auth.organizationId,
      actingUserId: auth.userId,
      envelope,
    });
    if (!created) {
      return NextResponse.json(
        { error: "Failed to persist AI draft" },
        { status: 500 },
      );
    }

    await writeAuditLog(supabase, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      actorName: auth.name,
      actorRole: auth.role,
      action: "create",
      module: "ai",
      objectType: "ai_draft",
      objectName: `settlement_batch:${created.id}`,
      after: {
        draftType: envelope.draftType,
        status: "pending",
        totals: envelope.payload.totals,
      },
      changedFields: ["ai_draft"],
    });

    return NextResponse.json({ draft: { id: created.id, ...envelope } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
