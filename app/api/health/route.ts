import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

// 健康检查端点（阶段0 整改 R3）：供外部探活/监控轮询。
// - 无鉴权、不回业务数据、不回显错误详情（避免泄漏内部信息）；
// - admin client 对 organizations 做 head 计数（不拉行）验证 DB 连通；
// - DB 异常或 admin client 不可用一律 503 { ok: false, db: false }。
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = createSupabaseAdminClient();
    if (!client) {
      return NextResponse.json({ ok: false, db: false }, { status: 503 });
    }

    const { error } = await client
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .limit(1);
    if (error) {
      return NextResponse.json({ ok: false, db: false }, { status: 503 });
    }

    return NextResponse.json({ ok: true, db: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
}
