import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import { createWebSearchProviderFromEnv } from "@/features/ai/web-search-provider";
import { loadStreamerProjectMarketReferences } from "@/features/streamers/streamer-project-market-references";
import { loadStreamerProjectReviewInput } from "@/features/streamers/streamer-project-review-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ai-tool-layer", () => ({
  runAiToolQuery: vi.fn(),
}));

vi.mock("@/features/ai/web-search-provider", () => ({
  createWebSearchProviderFromEnv: vi.fn(),
}));

vi.mock("@/features/streamers/streamer-project-review-loader", () => ({
  loadStreamerProjectReviewInput: vi.fn(),
}));

vi.mock("@/features/streamers/streamer-project-market-references", () => ({
  loadStreamerProjectMarketReferences: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

const profileInput = {
  streamer: { id: "streamer-1", displayName: "阿星" },
  project: { id: "project-1", name: "传奇复古", productType: "legend" },
  tasks: [],
  reports: [],
  recordings: [],
};

describe("streamer project review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadStreamerProjectReviewInput).mockResolvedValue(profileInput);
    vi.mocked(createWebSearchProviderFromEnv).mockReturnValue(null);
    vi.mocked(loadStreamerProjectMarketReferences).mockResolvedValue([]);
    vi.mocked(runAiToolQuery).mockResolvedValue({
      toolName: "streamer_project_review",
      invocationId: "invocation-1",
      mode: "deterministic",
      answer: "复盘档案已生成。",
      output: { profile: { streamer: profileInput.streamer } },
    });
  });

  it("loads profile input and runs the audited AI tool for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/streamer-project-review", {
        method: "POST",
        body: JSON.stringify({
          streamerId: "streamer-1",
          projectId: "project-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(loadStreamerProjectReviewInput).toHaveBeenCalledWith({
      supabase: { client: "supabase" },
      organizationId: "org-1",
      streamerId: "streamer-1",
      projectId: "project-1",
    });
    expect(runAiToolQuery).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      toolName: "streamer_project_review",
      input: { profileInput },
    });
    await expect(response.json()).resolves.toEqual({
      result: {
        toolName: "streamer_project_review",
        invocationId: "invocation-1",
        mode: "deterministic",
        answer: "复盘档案已生成。",
        output: { profile: { streamer: profileInput.streamer } },
      },
      profileInput,
    });
  });

  it("passes sanitized external references into the review profile input", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/streamer-project-review", {
        method: "POST",
        body: JSON.stringify({
          streamerId: "streamer-1",
          projectId: "project-1",
          externalReferences: [
            {
              id: "market-legend-1",
              title: "传奇复古类直播间强调长线留存和节奏稳定",
              sourceName: "行业观察",
              sourceUrl: "https://example.com/legend-live",
              retrievedAt: "2026-07-16T10:00:00.000Z",
              summary: "同类产品通常关注平均在线、讲解节奏和录屏可复用性。",
              productType: "legend",
              ignored: "should not pass through",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(loadStreamerProjectMarketReferences).not.toHaveBeenCalled();
    expect(runAiToolQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          profileInput: {
            ...profileInput,
            externalReferences: [
              {
                id: "market-legend-1",
                title: "传奇复古类直播间强调长线留存和节奏稳定",
                sourceName: "行业观察",
                sourceUrl: "https://example.com/legend-live",
                retrievedAt: "2026-07-16T10:00:00.000Z",
                summary: "同类产品通常关注平均在线、讲解节奏和录屏可复用性。",
                productType: "legend",
              },
            ],
          },
        },
      }),
    );
  });

  it("loads knowledge-base market references when none are provided", async () => {
    vi.mocked(loadStreamerProjectMarketReferences).mockResolvedValue([
      {
        id: "knowledge:doc-legend-1:chunk-legend-1",
        title: "传奇复古同类项目复盘",
        sourceName: "知识库",
        sourceUrl: null,
        retrievedAt: "2026-07-16T10:00:00.000Z",
        summary: "同类产品通常关注平均在线、讲解节奏和录屏可复用性。",
        productType: "legend",
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/ai/streamer-project-review", {
        method: "POST",
        body: JSON.stringify({
          streamerId: "streamer-1",
          projectId: "project-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(loadStreamerProjectMarketReferences).toHaveBeenCalledWith({
      client: { client: "supabase" },
      organizationId: "org-1",
      profileInput,
      webSearchProvider: null,
    });
    expect(runAiToolQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          profileInput: {
            ...profileInput,
            externalReferences: [
              {
                id: "knowledge:doc-legend-1:chunk-legend-1",
                title: "传奇复古同类项目复盘",
                sourceName: "知识库",
                sourceUrl: null,
                retrievedAt: "2026-07-16T10:00:00.000Z",
                summary: "同类产品通常关注平均在线、讲解节奏和录屏可复用性。",
                productType: "legend",
              },
            ],
          },
        },
      }),
    );
  });

  it("passes the configured web search provider into market reference loading", async () => {
    const webSearchProvider = { search: vi.fn() };
    vi.mocked(createWebSearchProviderFromEnv).mockReturnValue(webSearchProvider);

    const response = await POST(
      new Request("http://localhost/api/ai/streamer-project-review", {
        method: "POST",
        body: JSON.stringify({
          streamerId: "streamer-1",
          projectId: "project-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(loadStreamerProjectMarketReferences).toHaveBeenCalledWith({
      client: { client: "supabase" },
      organizationId: "org-1",
      profileInput,
      webSearchProvider,
    });
  });

  it("blocks streamers from internal streamer project review", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/ai/streamer-project-review", {
        method: "POST",
        body: JSON.stringify({
          streamerId: "streamer-1",
          projectId: "project-1",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(loadStreamerProjectReviewInput).not.toHaveBeenCalled();
  });

  it("rejects missing streamer or project ids", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/streamer-project-review", {
        method: "POST",
        body: JSON.stringify({ streamerId: "streamer-1" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Streamer and project are required",
    });
  });
});
