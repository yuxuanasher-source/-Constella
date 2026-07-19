import { describe, expect, it, vi } from "vitest";

import {
  createAnySearchWebSearchProvider,
  createTavilyWebSearchProvider,
  createWebSearchProviderFromEnv,
} from "./web-search-provider";

describe("createAnySearchWebSearchProvider", () => {
  it("posts an AnySearch JSON-RPC search request and normalizes MCP text results", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init: { body: string }) => ({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: "search-1",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  results: [
                    {
                      title: "传奇复古直播间公开复盘",
                      url: "https://example.com/public-legend",
                      snippet: "公开案例提到平均在线、主播讲解节奏和素材复用。",
                      score: 0.71,
                    },
                  ],
                }),
              },
            ],
          },
        }),
      }),
    );

    const provider = createAnySearchWebSearchProvider({
      apiKey: "as-test",
      fetchImpl,
    });

    await expect(
      provider.search({ query: "传奇复古 直播间 平均在线", maxResults: 2 }),
    ).resolves.toEqual([
      {
        title: "传奇复古直播间公开复盘",
        url: "https://example.com/public-legend",
        content: "公开案例提到平均在线、主播讲解节奏和素材复用。",
        score: 0.71,
        publishedAt: null,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anysearch.com/mcp",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer as-test",
          "Content-Type": "application/json",
        },
      }),
    );
    const init = fetchImpl.mock.calls[0]?.[1] as
      | { body: string }
      | undefined;
    if (!init) throw new Error("Expected AnySearch fetch options");
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: "2.0",
      id: expect.any(String),
      method: "tools/call",
      params: {
        name: "search",
        arguments: {
          query: "传奇复古 直播间 平均在线",
          limit: 2,
        },
      },
    });
  });

  it("supports anonymous AnySearch requests when no api key is provided", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { content: [] } }),
    }));

    const provider = createAnySearchWebSearchProvider({ fetchImpl });
    await provider.search({ query: "传奇复古" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anysearch.com/mcp",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

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
  it("returns null when no web search provider is configured", () => {
    expect(createWebSearchProviderFromEnv({})).toBeNull();
  });

  it("selects AnySearch when configured", async () => {
    const provider = createWebSearchProviderFromEnv({
      WEB_SEARCH_PROVIDER: "anysearch",
      ANYSEARCH_API_KEY: "as-test",
      ANYSEARCH_ENDPOINT: "https://example.com/mcp",
    });

    expect(provider).not.toBeNull();
  });
});
