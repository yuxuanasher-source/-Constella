import { NextResponse } from "next/server";

import { getAuthContext } from "@/lib/auth/context";
import { getPublicEnv } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  cosPutJson,
  isCosConfigured,
} from "@/lib/storage/tencent-cos";

// 生成知识库文档分享链接：把文档快照写入 COS（不可猜测 token），
// 返回 /share/kb/{token} 公开只读地址。分享内容是保存时的快照。

const MAX_BYTES = 8 * 1024 * 1024;

function makeToken() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isCosConfigured()) {
      return NextResponse.json(
        { error: "Tencent COS is not configured" },
        { status: 503 },
      );
    }
    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title : "复盘文档";
    const contentMd = typeof body?.contentMd === "string" ? body.contentMd : "";
    if (!contentMd.trim()) {
      return NextResponse.json({ error: "Empty document" }, { status: 400 });
    }
    if (contentMd.length > MAX_BYTES) {
      return NextResponse.json({ error: "Document too large" }, { status: 413 });
    }

    const token = makeToken();
    await cosPutJson(`knowledge-base-share/${token}.json`, {
      title,
      contentMd,
      organizationId: auth.organizationId,
      sharedBy: auth.name || auth.email,
      createdAt: new Date().toISOString(),
    });

    const base = getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    return NextResponse.json({ token, url: `${base}/share/kb/${token}` });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
