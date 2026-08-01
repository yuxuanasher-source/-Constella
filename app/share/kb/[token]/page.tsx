import type { Metadata } from "next";

import {
  createKnowledgeShareRepository,
  getPublicKnowledgeShare,
} from "@/features/knowledge-base/knowledge-share";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import {
  MARKDOWN_DOC_CSS,
  renderMarkdownToHtml,
} from "@/lib/markdown/render-markdown";
import { cosGetJson, isCosConfigured } from "@/lib/storage/tencent-cos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
  },
};

export default async function SharedKnowledgeDocPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let doc: Awaited<ReturnType<typeof getPublicKnowledgeShare>> = null;
  const admin = createSupabaseAdminClient();
  if (admin && isCosConfigured()) {
    try {
      doc = await getPublicKnowledgeShare(token, {
        repository: createKnowledgeShareRepository(admin),
        getSnapshot: cosGetJson,
      });
    } catch {
      doc = null;
    }
  }

  if (!doc) {
    return <InvalidKnowledgeShare />;
  }

  const html = renderMarkdownToHtml(doc.contentMd);
  const meta = [
    doc.sharedBy ? `分享人：${doc.sharedBy}` : "",
    doc.createdAt ? new Date(doc.createdAt).toLocaleString("zh-CN") : "",
    doc.expiresAt
      ? `有效期至 ${new Date(doc.expiresAt).toLocaleString("zh-CN")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main>
      <style>{MARKDOWN_DOC_CSS}</style>
      <div
        style={{
          maxWidth: 820,
          margin: "0 auto",
          padding: "8px 32px 0",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ fontSize: 12, color: "#64748b", padding: "8px 0" }}>
          经营舱 · 直播复盘分享 {meta ? `· ${meta}` : ""}
        </div>
      </div>
      <article>
        <h1>{doc.title || "复盘文档"}</h1>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </main>
  );
}

function InvalidKnowledgeShare() {
  return (
    <main
      style={{
        fontFamily:
          '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        maxWidth: 640,
        margin: "80px auto",
        padding: "0 24px",
        textAlign: "center",
        color: "#64748b",
      }}
    >
      <h1 style={{ fontSize: 20, color: "#1f2733" }}>链接无效或已过期</h1>
      <p>此链接当前不可访问。</p>
    </main>
  );
}
