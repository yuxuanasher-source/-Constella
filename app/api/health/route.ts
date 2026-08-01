import { NextResponse } from "next/server";

import {
  hermesRuntimeConfigurationErrorHealth,
  parseHermesRuntimeSelectionConfig,
  summarizeHermesRuntimeHealth,
} from "@/features/ai/hermes/runtime-selection";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

// 健康检查端点（阶段0 整改 R3）：供外部探活/监控轮询。
// - 无鉴权、不回业务数据、不回显错误详情（避免泄漏内部信息）；
// - admin client 对 organizations 做 head 计数（不拉行）验证 DB 连通；
// - DB 异常或 admin client 不可用一律 503 { ok: false, db: false }。
export const dynamic = "force-dynamic";

export async function GET() {
  let db = false;
  try {
    const client = createSupabaseAdminClient();
    if (!client) {
      return healthResponse(false, false);
    }

    const { error } = await client
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .limit(1);
    if (error) {
      return healthResponse(false, false);
    }

    db = true;
    return healthResponse(true, db);
  } catch {
    return healthResponse(false, db);
  }
}

function healthResponse(dbOk: boolean, db: boolean) {
  try {
    const hermesRuntime = summarizeHermesRuntimeHealth(
      parseHermesRuntimeSelectionConfig(process.env),
    );
    const ok = dbOk && hermesRuntime.compatibilityStatus !== "runtime_disabled";
    return NextResponse.json(
      {
        ok,
        db,
        hermesRuntime,
        release: {
          sha: process.env.RELEASE_SHA ?? null,
          manifestSha256: process.env.RELEASE_MANIFEST_SHA256 ?? null,
        },
      },
      { status: ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        db,
        hermesRuntime: hermesRuntimeConfigurationErrorHealth(),
        release: {
          sha: process.env.RELEASE_SHA ?? null,
          manifestSha256: process.env.RELEASE_MANIFEST_SHA256 ?? null,
        },
      },
      { status: 503 },
    );
  }
}
