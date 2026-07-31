import {
  MARKDOWN_DOC_CSS,
  renderMarkdownToHtml,
} from "@/lib/markdown/render-markdown";
import { cosGetJson } from "@/lib/storage/tencent-cos";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

type SharedDoc = {
  title?: string;
  contentMd?: string;
  sharedBy?: string;
  createdAt?: string;
};

function isSafeToken(token: string): boolean {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(token);
}

export default async function SharedKnowledgeDocPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let doc: SharedDoc | null = null;
  if (isSafeToken(token)) {
    try {
      doc = await cosGetJson<SharedDoc>(`knowledge-base-share/${token}.json`);
    } catch {
      doc = null;
    }
  }

  if (!doc || !doc.contentMd) {
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
        <p>该分享链接对应的文档不存在，或云端存储未配置。</p>
      </main>
    );
  }

  const html = renderMarkdownToHtml(doc.contentMd);
  const meta = [
    doc.sharedBy ? `分享人：${doc.sharedBy}` : "",
    doc.createdAt ? new Date(doc.createdAt).toLocaleString("zh-CN") : "",
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
        <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0" }}>
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
