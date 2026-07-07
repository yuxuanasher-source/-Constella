import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { loadRecordingTranscriptContext } from "@/features/recordings/recording-transcript";
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

function request() {
  return new Request(
    "http://localhost/api/recording-assets/asset-1/transcript",
  );
}

const routeContext = { params: Promise.resolve({ assetId: "asset-1" }) };

describe("recording asset transcript route", () => {
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
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await GET(request(), routeContext);

    expect(response.status).toBe(401);
    expect(loadRecordingTranscriptContext).not.toHaveBeenCalled();
  });

  it("blocks streamers from reading the annotated transcript", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await GET(request(), routeContext);

    expect(response.status).toBe(403);
    expect(loadRecordingTranscriptContext).not.toHaveBeenCalled();
  });

  it("returns 404 when the asset does not belong to the organization", async () => {
    vi.mocked(loadRecordingTranscriptContext).mockResolvedValue({
      asset: null,
      transcript: null,
    });

    const response = await GET(request(), routeContext);

    expect(response.status).toBe(404);
    expect(loadRecordingTranscriptContext).toHaveBeenCalledWith({
      client: { client: "supabase" },
      organizationId: "org-1",
      assetId: "asset-1",
    });
  });

  it("returns available:false with 200 when no transcript exists", async () => {
    vi.mocked(loadRecordingTranscriptContext).mockResolvedValue({
      asset: { id: "asset-1", title: "0701 大场" },
      transcript: null,
    });

    const response = await GET(request(), routeContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      transcript: { available: false },
    });
  });

  it("returns the annotated transcript with risk segments and summary", async () => {
    const response = await GET(request(), routeContext);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.transcript).toMatchObject({
      available: true,
      asrProvider: "doubao_asr",
      analysisId: "analysis-1",
    });
    expect(payload.transcript.utterances).toEqual([
      {
        index: 0,
        startSeconds: 1,
        endSeconds: 3,
        text: "欢迎来到直播间",
        segments: [{ text: "欢迎来到直播间", tone: null }],
      },
      {
        index: 1,
        startSeconds: 65,
        endSeconds: 68,
        text: "想赌博的加我微信",
        segments: [
          { text: "想", tone: null },
          {
            text: "赌博",
            tone: "violation",
            keyword: "赌博",
            category: "sensitive_word",
          },
          { text: "的", tone: null },
          {
            text: "加我微信",
            tone: "warning",
            keyword: "加我微信",
            category: "sensitive_word",
          },
        ],
      },
    ]);
    expect(payload.transcript.summary).toEqual({
      violationCount: 1,
      warningCount: 1,
      keywords: [
        {
          keyword: "赌博",
          tone: "violation",
          category: "sensitive_word",
          count: 1,
        },
        {
          keyword: "加我微信",
          tone: "warning",
          category: "sensitive_word",
          count: 1,
        },
      ],
    });
    // 这两句不含高频词词典词：数组为空、密度为 0、占比为 null。
    expect(payload.transcript.wordInsights).toEqual({
      effective: [],
      ineffective: [],
      neutral: [],
      metrics: {
        effectiveCount: 0,
        ineffectiveCount: 0,
        utteranceCount: 2,
        fillerPerUtterance: 0,
        effectiveShare: null,
      },
    });
  });

  it("returns word insights matching the locked contract when dictionary words hit", async () => {
    vi.mocked(loadRecordingTranscriptContext).mockResolvedValue({
      asset: { id: "asset-1", title: "0701 大场" },
      transcript: {
        analysisId: "analysis-1",
        asrProvider: "doubao_asr",
        completedAt: "2026-07-01T10:00:00.000Z",
        utterances: [
          { text: "家人们点赞走起", startSeconds: 1, endSeconds: 3 },
          { text: "嗯那个福利安排", startSeconds: 4, endSeconds: 6 },
        ],
      },
    });

    const response = await GET(request(), routeContext);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.transcript.wordInsights).toEqual({
      // count 相同：conversion 类排在 interaction 前。
      effective: [
        {
          word: "安排",
          category: "conversion",
          categoryLabel: "转化引导",
          count: 1,
        },
        {
          word: "福利",
          category: "conversion",
          categoryLabel: "转化引导",
          count: 1,
        },
        {
          word: "家人们",
          category: "interaction",
          categoryLabel: "互动",
          count: 1,
        },
        {
          word: "点赞",
          category: "interaction",
          categoryLabel: "互动",
          count: 1,
        },
      ],
      ineffective: [
        { word: "嗯", count: 1 },
        { word: "那个", count: 1 },
      ],
      neutral: [],
      metrics: {
        effectiveCount: 4,
        ineffectiveCount: 2,
        utteranceCount: 2,
        fillerPerUtterance: 1,
        effectiveShare: 0.667,
      },
    });
  });
});
