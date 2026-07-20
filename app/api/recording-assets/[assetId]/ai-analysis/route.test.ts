import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { requestRecordingAiAnalysis } from "@/features/recordings/recording-ai-analysis";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/recordings/recording-ai-analysis", () => ({
  requestRecordingAiAnalysis: vi.fn(),
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

// 带 storage 元信息与月度用量计数的伪 client：from 按表名分流，
// recording_asset_sources → 尺寸闸门的主 source 查询，
// recording_ai_analyses → 配额闸门的 head+count 计数。
function fakeSizeGateClient({
  storagePath = "org-1/recordings/app-1/replay.mp4",
  size,
  infoError = null,
  analysisCount = 0,
  analysisCountError = null,
}: {
  storagePath?: string | null;
  size?: number;
  infoError?: Error | null;
  analysisCount?: number;
  analysisCountError?: Error | null;
}) {
  const sourcesQuery = {
    select: () => sourcesQuery,
    eq: () => sourcesQuery,
    order: () => sourcesQuery,
    limit: () => sourcesQuery,
    maybeSingle: async () => ({
      data: storagePath ? { storage_path: storagePath } : null,
      error: null,
    }),
  };
  const quotaGte = vi.fn(async () => ({
    count: analysisCountError ? null : analysisCount,
    error: analysisCountError,
  }));
  const quotaEq = vi.fn(() => analysesQuery);
  const analysesQuery = {
    select: vi.fn(() => analysesQuery),
    eq: quotaEq,
    gte: quotaGte,
  };
  const info = vi.fn(async () =>
    infoError
      ? { data: null, error: infoError }
      : { data: { size }, error: null },
  );
  return {
    from: (table: string) =>
      table === "recording_ai_analyses" ? analysesQuery : sourcesQuery,
    storage: { from: () => ({ info }) },
    info,
    quotaEq,
    quotaGte,
  };
}

describe("recording asset AI analysis route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(requestRecordingAiAnalysis).mockResolvedValue({
      id: "analysis-1",
      assetId: "asset-1",
      status: "queued",
      statusLabel: "排队中",
      providerName: null,
      summary: "",
      scorecard: {},
      dimensions: [],
      riskFlags: [],
      recommendations: [],
      segments: [],
      errorSummary: null,
      transcriptText: null,
      asrProvider: null,
      aiInvocationId: "invocation-1",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:00:00.000Z",
      completedAt: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("queues a recording AI analysis for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      analysis: expect.objectContaining({
        id: "analysis-1",
        status: "queued",
      }),
    });
    expect(requestRecordingAiAnalysis).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: auth,
      assetId: "asset-1",
    });
  });

  it("blocks analysis startup when the primary storage object exceeds the size limit", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeSizeGateClient({ size: 314572801 }) as never,
    );

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toEqual({
      error: "录屏文件超过解析大小上限",
    });
    expect(payload.error).toMatch(/解析/);
    expect(payload.error).not.toMatch(/拒绝|驳回|入项|准入失败/);
    expect(requestRecordingAiAnalysis).not.toHaveBeenCalled();
  });

  it("queues analysis when the storage object is within the size limit", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeSizeGateClient({ size: 314572800 }) as never,
    );

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(202);
    expect(requestRecordingAiAnalysis).toHaveBeenCalledOnce();
  });

  it("queues analysis when the storage metadata lookup fails", async () => {
    const client = fakeSizeGateClient({
      infoError: new Error("Object not found"),
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(202);
    expect(client.info).toHaveBeenCalledOnce();
    expect(requestRecordingAiAnalysis).toHaveBeenCalledOnce();
  });

  it("queues analysis when the asset has no storage source", async () => {
    const client = fakeSizeGateClient({ storagePath: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(202);
    expect(client.info).not.toHaveBeenCalled();
    expect(requestRecordingAiAnalysis).toHaveBeenCalledOnce();
  });

  it("rejects the analysis with 429 once the monthly quota is used up", async () => {
    // 默认配额 100：本月已有 100 条 → 第 101 条硬拒。
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeSizeGateClient({ size: 1024, analysisCount: 100 }) as never,
    );

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "本月解析额度已用完（100 条/月），下月自动恢复",
      quota: { used: 100, limit: 100 },
    });
    expect(requestRecordingAiAnalysis).not.toHaveBeenCalled();
  });

  it("interpolates the env-configured quota into the 429 message", async () => {
    vi.stubEnv("RECORDING_AI_MONTHLY_QUOTA", "2");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeSizeGateClient({ size: 1024, analysisCount: 2 }) as never,
    );

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "本月解析额度已用完（2 条/月），下月自动恢复",
      quota: { used: 2, limit: 2 },
    });
  });

  it("attaches quota usage to the 202 response", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeSizeGateClient({ size: 1024, analysisCount: 4 }) as never,
    );

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      analysis: expect.objectContaining({ id: "analysis-1" }),
      // used 含本次刚入队的一条：4 条历史 + 1 条新入队。
      quota: { used: 5, limit: 100 },
    });
  });

  it("scopes the quota count to the Asia/Shanghai calendar month", async () => {
    // 2026-06-30T20:00Z 在上海已是 2026-07-01 04:00 → 月初应取
    // 2026-07-01 00:00（上海）= 2026-06-30T16:00:00Z，而非 UTC 的 6 月月初。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T20:00:00.000Z"));
    const client = fakeSizeGateClient({ size: 1024, analysisCount: 4 });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(202);
    expect(client.quotaEq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(client.quotaGte).toHaveBeenCalledWith(
      "created_at",
      "2026-06-30T16:00:00.000Z",
    );
  });

  it("queues the analysis without quota info when the usage count fails", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeSizeGateClient({
        size: 1024,
        analysisCountError: new Error("count unavailable"),
      }) as never,
    );

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      analysis: expect.objectContaining({ id: "analysis-1" }),
    });
    expect(requestRecordingAiAnalysis).toHaveBeenCalledOnce();
  });

  it("blocks streamers from starting internal analysis", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/recording-assets/asset-1/ai-analysis", {
        method: "POST",
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(403);
    expect(requestRecordingAiAnalysis).not.toHaveBeenCalled();
  });
});
