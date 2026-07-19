import { describe, expect, it, vi } from "vitest";

import {
  createTavilyWebSearchProvider,
  createWebSearchProviderFromEnv,
} from "./web-search-provider";

describe("createTavilyWebSearchProvider", () => {
  it("posts a Tavily search request and normalizes results", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "传奇复古直播复盘",
            url: "https://example.com/legend",
            content: "同类直播间关注平均在线、讲解节奏和录屏可复用性。",
            score: 0.82,
            published_date: "2026-07-01",
          },
        ],
      }),
    }));

    const provider = createTavilyWebSearchProvider({
      apiKey: "tvly-test",
      fetchImpl,
    });

    await expect(
      provider.search({ query: "传奇复古 直播间 平均在线", maxResults: 2 }),
    ).resolves.toEqual([
      {
        title: "传奇复古直播复盘",
        url: "https://example.com/legend",
        content: "同类直播间关注平均在线、讲解节奏和录屏可复用性。",
        score: 0.82,
        publishedAt: "2026-07-01",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer tvly-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "传奇复古 直播间 平均在线",
          max_results: 2,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        }),
      }),
    );
  });

  it("fails closed when Tavily returns an error", async () => {
    const provider = createTavilyWebSearchProvider({
      apiKey: "tvly-test",
      fetchImpl: vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      })),
    });

    await expect(provider.search({ query: "传奇复古" })).rejects.toThrow(
      "Tavily search failed: 401 unauthorized",
    );
  });
});

describe("createWebSearchProviderFromEnv", () => {
  it("returns null when no Tavily key is configured", () => {
    expect(createWebSearchProviderFromEnv({})).toBeNull();
  });
});
