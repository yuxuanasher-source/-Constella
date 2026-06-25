import { NextResponse } from "next/server";

import { listAiDrafts, type DraftClient } from "@/features/ai/draft-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

const STATUSES = new Set(["pending", "confirmed", "discarded"]);

// 列出本组织 AI 草稿（走 RLS）。默认仅 pending（待确认）。
export async function GET(request: Request) {
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
        { error: "Only MCN staff can view AI drafts" },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status")?.trim() || "pending";
    const status = STATUSES.has(statusParam) ? statusParam : "pending";

    const drafts = await listAiDrafts(supabase as unknown as DraftClient, {
      organizationId: auth.organizationId,
      status,
    });
    return NextResponse.json({ drafts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
