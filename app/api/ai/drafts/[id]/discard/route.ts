import { NextResponse } from "next/server";

import { discardAiDraft, type DraftClient } from "@/features/ai/draft-repository";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

// 弃用草稿（pending → discarded）。草稿态可弃，不影响主流程。
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
        { error: "Only MCN staff can discard AI drafts" },
        { status: 403 },
      );
    }

    const ok = await discardAiDraft(supabase as unknown as DraftClient, {
      organizationId: auth.organizationId,
      draftId: id,
    });
    if (!ok) {
      return NextResponse.json(
        { error: "Failed to discard AI draft" },
        { status: 500 },
      );
    }

    await writeAuditLog(supabase, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      actorName: auth.name,
      actorRole: auth.role,
      action: "reject",
      module: "ai",
      objectType: "ai_draft",
      objectName: `ai_draft:${id}`,
      after: { status: "discarded" },
      changedFields: ["status"],
    });

    return NextResponse.json({ ok: true, id, status: "discarded" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
