import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { upsertKnowledgeAssetDocument } from "@/features/ai/knowledge-asset-index";
import { loadRecordingTranscriptContext } from "@/features/recordings/recording-transcript";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/recordings/recording-transcript", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/recordings/recording-transcript")
  >("@/features/recordings/recording-transcript");
  return {
    ...actual,
    loadRecordingTranscriptContext: vi.fn(),
  };
});

vi.mock("@/features/ai/knowledge-asset-index", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/ai/knowledge-asset-index")
  >("@/features/ai/knowledge-asset-index");
  return {
    ...actual,
    upsertKnowledgeAssetDocument: vi.fn(),
  };
});

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@example.com",
  name: "Ops",
  organizationId: "org-1",
  organizationName: "Org",
  role: "ops_manager" as const,
};

function request(body: unknown) {
  return new Request(
    "http://localhost/api/recording-assets/asset-1/transcript/export",
    { method: "POST", body: JSON.stringify(body) },
  );
}

const routeContext = { params: Promise.resolve({ assetId: "asset-1" }) };

describe("recording asset transcript export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadRecordingTranscriptContext).mockResolvedValue({
      asset: { id: "asset-1", title: "0701 大场" },
      transcript: {
        analysisId: "analysis-1",
        asrProvider: "doubao_asr",
        completedAt: "2026-07-01T10:00:00.000Z",
        utterances: [
          { text: "欢迎来到直播间", startSeconds: 1, endSeconds: 3 },
          { text: "想赌博的加我微信", startSeconds: 65, endSeconds: 68 },
        ],
      },
    });
    vi.mocked(upsertKnowledgeAssetDocument).mockResolvedValue({ id: "doc-1" });
    vi.mocked(writeAuditLog).mockResolvedValue();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(request({ format: "knowledge" }), routeContext);

    expect(response.status).toBe(401);
    expect(loadRecordingTranscriptContext).not.toHaveBeenCalled();
  });

  it("blocks streamers from exporting transcripts", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" });

    const response = await POST(request({ format: "docx" }), routeContext);

    expect(response.status).toBe(403);
    expect(loadRecordingTranscriptContext).not.toHaveBeenCalled();
  });

  it("rejects unsupported formats with 400", async () => {
    const response = await POST(request({ format: "csv" }), routeContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported export format",
    });
    expect(loadRecordingTranscriptContext).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns 404 when the asset does not belong to the organization", async () => {
    vi.mocked(loadRecordingTranscriptContext).mockResolvedValue({
      asset: null,
      transcript: null,
    });

    const response = await POST(request({ format: "knowledge" }), routeContext);

    expect(response.status).toBe(404);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns transcript_unavailable when the asset has no transcript", async () => {
    vi.mocked(loadRecordingTranscriptContext).mockResolvedValue({
      asset: { id: "asset-1", title: "0701 大场" },
      transcript: null,
    });

    const response = await POST(request({ format: "pdf" }), routeContext);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "transcript_unavailable",
    });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("deposits the annotated transcript into the knowledge base with timestamps", async () => {
    const response = await POST(
      request({ format: "knowledge", includeTimestamps: true }),
      routeContext,
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toEqual({
      document: {
        id: "doc-1",
        title: expect.stringMatching(/^逐字稿：0701 大场·\d{4}-\d{2}-\d{2}$/),
      },
    });

    const [, doc] = vi.mocked(upsertKnowledgeAssetDocument).mock.calls[0];
    expect(doc).toMatchObject({
      organizationId: "org-1",
      docType: "manual",
      sourceRef: "recording_transcript:analysis-1",
      createdBy: "user-ops",
      metadata: { source: "recording_transcript" },
    });
    // 违规红词 / 风险黄词的内联标记 + 摘要头部 + [MM:SS] 时间戳。
    expect(doc.body).toContain("- [00:01] 欢迎来到直播间");
    expect(doc.body).toContain("- [01:05] 想【违规:赌博】的【风险:加我微信】");
    expect(doc.body).toContain("违规命中 1 处 · 风险命中 1 处");
    expect(doc.body).toContain("违规「赌博」×1");
    // 高频词块始终存在；这两句没有词典命中 → 列表为「无」、占比为「—」。
    expect(doc.body).toContain("## 高频词");
    expect(doc.body).toContain("- 有效词 Top5：无");
    expect(doc.body).toContain("- 无效水词 Top5：无");
    expect(doc.body).toContain(
      "- 口播指标：水词密度 0 词/句 · 有效话术占比 —",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      { client: "supabase" },
      expect.objectContaining({
        action: "export",
        module: "export",
        objectType: "export_job",
        objectId: "asset-1",
        after: expect.objectContaining({
          kind: "recording_transcript_knowledge",
          includeTimestamps: true,
          rowCount: 2,
          violationCount: 1,
          warningCount: 1,
          knowledgeDocumentId: "doc-1",
        }),
      }),
    );
  });

  it("omits timestamps from the knowledge body when includeTimestamps is false", async () => {
    const response = await POST(
      request({ format: "knowledge", includeTimestamps: false }),
      routeContext,
    );

    expect(response.status).toBe(201);
    const [, doc] = vi.mocked(upsertKnowledgeAssetDocument).mock.calls[0];
    expect(doc.body).toContain("- 欢迎来到直播间");
    expect(doc.body).toContain("- 想【违规:赌博】的【风险:加我微信】");
    expect(doc.body).not.toContain("[00:01]");
    expect(doc.body).not.toContain("[01:05]");
    // 高频词块与 includeTimestamps 无关，关掉时间戳时依然存在。
    expect(doc.body).toContain("## 高频词");
  });

  it("includes the word insights block with hits in the knowledge export", async () => {
    vi.mocked(loadRecordingTranscriptContext).mockResolvedValue({
      asset: { id: "asset-1", title: "0701 大场" },
      transcript: {
        analysisId: "analysis-1",
        asrProvider: "doubao_asr",
        completedAt: "2026-07-01T10:00:00.000Z",
        utterances: [
          { text: "家人们家人们点赞", startSeconds: 1, endSeconds: 3 },
          { text: "嗯嗯嗯那个就是", startSeconds: 4, endSeconds: 6 },
        ],
      },
    });

    const response = await POST(request({ format: "knowledge" }), routeContext);

    expect(response.status).toBe(201);
    const [, doc] = vi.mocked(upsertKnowledgeAssetDocument).mock.calls[0];
    expect(doc.body).toContain("## 高频词");
    expect(doc.body).toContain(
      "- 有效词 Top5：互动「家人们」×2、互动「点赞」×1",
    );
    expect(doc.body).toContain(
      "- 无效水词 Top5：「嗯」×3、「就是」×1、「那个」×1",
    );
    // 水词密度 5/2=2.5 词/句；有效占比 3/(3+5)=37.5% → 四舍五入 38%。
    expect(doc.body).toContain(
      "- 口播指标：水词密度 2.5 词/句 · 有效话术占比 38%",
    );
  });

  it("exports a Word attachment with the docx magic bytes", async () => {
    const response = await POST(
      request({ format: "docx", includeTimestamps: true }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("attachment;");
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent("逐字稿-0701 大场")}`,
    );
    expect(disposition).toContain(".docx");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(200);
    // ZIP（docx）魔数 "PK"。
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");

    expect(writeAuditLog).toHaveBeenCalledWith(
      { client: "supabase" },
      expect.objectContaining({
        action: "export",
        module: "export",
        after: expect.objectContaining({ kind: "recording_transcript_docx" }),
      }),
    );
  });

  it("exports a PDF attachment with the %PDF magic bytes", async () => {
    const response = await POST(
      request({ format: "pdf", includeTimestamps: false }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("attachment;");
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(".pdf");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(500);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe(
      "%PDF",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      { client: "supabase" },
      expect.objectContaining({
        action: "export",
        module: "export",
        after: expect.objectContaining({
          kind: "recording_transcript_pdf",
          includeTimestamps: false,
        }),
      }),
    );
  }, 30_000);
});
