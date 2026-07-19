import { describe, expect, it, vi } from "vitest";

import {
  createAnySearchWebSearchProvider,
  createTavilyWebSearchProvider,
  createWebSearchProviderFromEnv,
} from "./web-search-provider";

describe("createAnySearchWebSearchProvider", () => {
  it("posts an AnySearch JSON-RPC search request and normalizes MCP text results", async () => {
    const fetchImpl = vi.fn(async (url: string, init: { body: string }) => {
      expect(url).toBe("https://api.anysearch.com/mcp");
      expect(init.body).toContain('"tools/call"');
      return {
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
      };
    });

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
    const init = fetchImpl.mock.calls[0]?.[1] as { body: string } | undefined;
    if (!init) throw new Error("Expected AnySearch fetch options");
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: "2.0",
      id: expect.any(String),
      method: "tools/call",
      params: {
        name: "search",
        arguments: {
          query: "传奇复古 直播间 平均在线",
          max_results: 2,
        },
      },
    });
  });

  it("parses AnySearch markdown search output returned by the MCP text item", async () => {
    const fetchImpl = vi.fn(async (url: string, init: { body: string }) => {
      expect(url).toBe("https://api.anysearch.com/mcp");
      expect(init.body).toContain('"tools/call"');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: "search-1",
          result: {
            content: [
              {
                type: "text",
                text: [
                  "## Search Results (2 results)",
                  "",
                  "### 1. Legend launch benchmark",
                  "- **URL**: https://example.com/legend-live",
                  "- **Snippet**: Comparable live rooms report average online users around 120-180 during launch windows.",
                  "- **Published**: 2026-07-18",
                  "",
                  "### 2. Platform PCU guide",
                  "- **URL**: https://example.com/pcu-acu",
                  "- **Snippet**: PCU and ACU should be verified from platform dashboards before reuse.",
                ].join("\n"),
              },
            ],
          },
        }),
      };
    });

    const provider = createAnySearchWebSearchProvider({
      apiKey: "as-test",
      fetchImpl,
    });

    await expect(
      provider.search({ query: "legend live benchmark", maxResults: 2 }),
    ).resolves.toEqual([
      {
        title: "Legend launch benchmark",
        url: "https://example.com/legend-live",
        content:
          "Comparable live rooms report average online users around 120-180 during launch windows.",
        publishedAt: "2026-07-18",
      },
      {
        title: "Platform PCU guide",
        url: "https://example.com/pcu-acu",
        content:
          "PCU and ACU should be verified from platform dashboards before reuse.",
        publishedAt: null,
      },
    ]);

    const init = fetchImpl.mock.calls[0]?.[1] as { body: string } | undefined;
    if (!init) throw new Error("Expected AnySearch fetch options");
    expect(JSON.parse(init.body).params.arguments).toEqual({
      query: "legend live benchmark",
      max_results: 2,
    });
  });

  it("throws when AnySearch returns a JSON-RPC tool error inside result", async () => {
    const provider = createAnySearchWebSearchProvider({
      apiKey: "as-test",
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: "search-1",
          result: {
            content: [
              {
                type: "text",
                text: "invalid_api_key\nInvalid API key.",
              },
            ],
            isError: true,
          },
        }),
      })),
    });

    await expect(
      provider.search({ query: "legend live benchmark" }),
    ).rejects.toThrow("AnySearch search failed: invalid_api_key");
  });

  it("parses AnySearch markdown results with inline URL labels", async () => {
    const provider = createAnySearchWebSearchProvider({
      apiKey: "as-test",
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            content: [
              {
                type: "text",
                text: [
                  "### Search Results (2 results)",
                  "",
                  "1. Kua Niu Legend - **URL**: https://example.com/kua-niu",
                  "Snippet: First result snippet.",
                  "",
                  "2. Another Legend - **URL**: https://example.com/another",
                  "Snippet: Second result snippet.",
                ].join("\n"),
              },
            ],
          },
        }),
      })),
    });

    await expect(
      provider.search({ query: "legend live benchmark" }),
    ).resolves.toEqual([
      {
        title: "Kua Niu Legend",
        url: "https://example.com/kua-niu",
        content: "First result snippet.",
        publishedAt: null,
      },
      {
        title: "Another Legend",
        url: "https://example.com/another",
        content: "Second result snippet.",
        publishedAt: null,
      },
    ]);
  });

  it("drops AnySearch results with non-http URLs", async () => {
    const provider = createAnySearchWebSearchProvider({
      apiKey: "as-test",
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  results: [
                    {
                      title: "Unsafe script URL",
                      url: "javascript:alert(1)",
                      snippet: "This result must not be rendered.",
                    },
                    {
                      title: "Unsafe data URL",
                      url: "data:text/html,hello",
                      snippet: "This result must not be rendered either.",
                    },
                    {
                      title: "Safe source",
                      url: "https://example.com/safe",
                      snippet: "This result is safe to keep.",
                    },
                  ],
                }),
              },
            ],
          },
        }),
      })),
    });

    await expect(
      provider.search({ query: "legend live benchmark" }),
    ).resolves.toEqual([
      {
        title: "Safe source",
        url: "https://example.com/safe",
        content: "This result is safe to keep.",
        score: undefined,
        publishedAt: null,
      },
    ]);
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
