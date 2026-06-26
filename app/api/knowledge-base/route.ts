import { NextResponse } from "next/server";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  cosGetJson,
  cosPutJson,
  isCosConfigured,
} from "@/lib/storage/tencent-cos";

// 知识库持久化到腾讯云 COS：每个组织一份树形 JSON
//   knowledge-base/{organizationId}/tree.json
// 鉴权用 Supabase 会话拿到 organizationId，COS 密钥仅存于服务端。
// 未配置 COS 时优雅降级（GET 返回 store:null，PUT 返回 503），前端回退本地缓存。

const MAX_BYTES = 20 * 1024 * 1024;

function cosKey(organizationId: string) {
  return `knowledge-base/${organizationId}/tree.json`;
}

async function resolveOrgId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const auth = await getAuthContext(supabase);
  return auth?.organizationId ?? null;
}

export async function GET() {
  try {
    const organizationId = await resolveOrgId();
    if (!organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isCosConfigured()) {
      return NextResponse.json({ store: null, configured: false });
    }
    const store = await cosGetJson(cosKey(organizationId));
    return NextResponse.json({ store, configured: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const organizationId = await resolveOrgId();
    if (!organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isCosConfigured()) {
      return NextResponse.json(
        { error: "Tencent COS is not configured" },
        { status: 503 },
      );
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("store" in body)) {
      return NextResponse.json({ error: "Missing store" }, { status: 400 });
    }
    const store = (body as { store: unknown }).store;
    if (JSON.stringify(store).length > MAX_BYTES) {
      return NextResponse.json(
        { error: "Knowledge base too large" },
        { status: 413 },
      );
    }
    await cosPutJson(cosKey(organizationId), store);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
