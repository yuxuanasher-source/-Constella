import { NextResponse } from "next/server";

import { confirmAiDraft, type DraftClient } from "@/features/ai/draft-repository";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

// 人工确认草稿（pending → confirmed）。确认是人的动作，记录 confirmed_by（审计）。
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
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
        { error: "Only MCN staff can confirm AI drafts" },
        { status: 403 },
      );
    }

    const ok = await confirmAiDraft(supabase as unknown as DraftClient, {
      organizationId: auth.organizationId,
      draftId: id,
      confirmedBy: auth.userId,
    });
    if (!ok) {
      return NextResponse.json(
        { error: "Failed to confirm AI draft" },
        { status: 500 },
      );
    }

    await writeAuditLog(supabase, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      actorName: auth.name,
      actorRole: auth.role,
      action: "approve",
      module: "ai",
      objectType: "ai_draft",
      objectName: `ai_draft:${id}`,
      after: { status: "confirmed", confirmedBy: auth.userId },
      changedFields: ["status", "confirmed_by"],
    });

    return NextResponse.json({ ok: true, id, status: "confirmed" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
