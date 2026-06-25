import { NextResponse } from "next/server";

import { assembleKnowledgeAnswer } from "@/features/ai/knowledge-base";
import {
  searchKnowledgeDocuments,
  type KnowledgeClient,
} from "@/features/ai/knowledge-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

// L1 知识库问数（kb_search / RAG）。走 RLS 拉本组织语料 → 确定性打分 → 带引用作答。
// 铁律：语料仅用于解释 / 归因；无命中一律「无数据」，绝不臆造数字（数字另走结构化查询）。
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
        { error: "Only MCN staff can query the knowledge base" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const query = String(body?.query ?? "").trim();
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }
    const docTypes = Array.isArray(body?.docTypes)
      ? body.docTypes.filter((t: unknown) => typeof t === "string")
      : undefined;
    const limit =
      Number.isFinite(body?.limit) && body.limit > 0
        ? Math.min(Math.floor(body.limit), 20)
        : 5;

    const passages = await searchKnowledgeDocuments(
      supabase as unknown as KnowledgeClient,
      { organizationId: auth.organizationId, query, docTypes, limit },
    );
    const answer = assembleKnowledgeAnswer(query, passages);

    return NextResponse.json({
      query,
      hasData: answer.hasData,
      answer: answer.answer,
      citations: answer.citations,
      passages,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
