import { NextResponse } from "next/server";

import {
  auditAiProduction,
  type ProductionAuditInput,
} from "@/features/ai/production-auditor";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

/**
 * AI 生产执行与审计一体化引擎入口。
 *
 * 对一次候选 AI 产出做生产级自检（真实性 / 落地性 / 流程嵌入 / 结构化），
 * 返回标准结构化裁决。仅 MCN 内部员工可调用，主播端无权访问审计能力。
 */
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
        { error: "Only MCN staff can run AI production audits" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as ProductionAuditInput;
    const verdict = auditAiProduction(body);

    return NextResponse.json({ verdict });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
