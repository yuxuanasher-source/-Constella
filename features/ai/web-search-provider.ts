export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedAt?: string | null;
};

export type WebSearchProvider = {
  search(input: {
    query: string;
    maxResults?: number;
  }): Promise<WebSearchResult[]>;
};

type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export function createWebSearchProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): WebSearchProvider | null {
  const provider = env.WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  const anySearchApiKey = env.ANYSEARCH_API_KEY?.trim();
  if (provider === "anysearch" || anySearchApiKey) {
    return createAnySearchWebSearchProvider({
      apiKey: anySearchApiKey,
      endpoint: env.ANYSEARCH_ENDPOINT,
    });
  }
  const apiKey = env.TAVILY_API_KEY?.trim();
  if (provider === "tavily" && !apiKey) return null;
  if (!apiKey) return null;
  return createTavilyWebSearchProvider({
    apiKey,
    endpoint: env.TAVILY_SEARCH_URL,
  });
}

export function createAnySearchWebSearchProvider({
  apiKey,
  endpoint = "https://api.anysearch.com/mcp",
  fetchImpl = fetch as unknown as FetchLike,
}: {
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
} = {}): WebSearchProvider {
  return {
    async search({ query, maxResults = 3 }) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey?.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      }
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `search-${Date.now()}`,
          method: "tools/call",
          params: {
            name: "search",
            arguments: {
              query,
              limit: maxResults,
            },
          },
        }),
      });
      if (!response.ok) {
        const body = response.text ? await response.text() : "";
        throw new Error(`AnySearch search failed: ${response.status} ${body}`.trim());
      }

      const payload = response.json ? await response.json() : {};
      return normalizeAnySearchResults(payload);
    },
  };
}

export function createTavilyWebSearchProvider({
  apiKey,
  endpoint = "https://api.tavily.com/search",
  fetchImpl = fetch as unknown as FetchLike,
}: {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}): WebSearchProvider {
  return {
    async search({ query, maxResults = 3 }) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        }),
      });
      if (!response.ok) {
        const body = response.text ? await response.text() : "";
        throw new Error(`Tavily search failed: ${response.status} ${body}`.trim());
      }

      const payload = response.json ? await response.json() : {};
      return normalizeTavilyResults(payload);
    },
  };
}

function normalizeTavilyResults(payload: unknown): WebSearchResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
  const results: WebSearchResult[] = [];
  for (const item of payload.results) {
    if (!isRecord(item)) continue;
    const title = stringValue(item.title);
    const url = stringValue(item.url);
    const content = stringValue(item.content);
    if (!title || !url || !content) continue;
    results.push({
      title,
      url,
      content,
      score: numberValue(item.score),
      publishedAt:
        stringValue(item.publishedAt) || stringValue(item.published_date) || null,
    });
  }
  return results;
}

function normalizeAnySearchResults(payload: unknown): WebSearchResult[] {
  if (!isRecord(payload)) return [];
  if (isRecord(payload.error)) {
    const message = stringValue(payload.error.message) || "unknown error";
    throw new Error(`AnySearch search failed: ${message}`);
  }
  const result = payload.result;
  if (!isRecord(result) || !Array.isArray(result.content)) return [];
  const results: WebSearchResult[] = [];
  for (const content of result.content) {
    if (!isRecord(content) || content.type !== "text") continue;
    results.push(...normalizeAnySearchText(stringValue(content.text)));
  }
  return results;
}

function normalizeAnySearchText(text: string): WebSearchResult[] {
  if (!text) return [];
  const parsed = parseJson(text);
  if (parsed) return normalizeGenericSearchResults(parsed);
  return [];
}

function normalizeGenericSearchResults(payload: unknown): WebSearchResult[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.results)
      ? payload.results
      : [];
  const results: WebSearchResult[] = [];
  for (const item of rows) {
    if (!isRecord(item)) continue;
    const title = stringValue(item.title);
    const url = stringValue(item.url) || stringValue(item.link);
    const content =
      stringValue(item.content) ||
      stringValue(item.snippet) ||
      stringValue(item.description);
    if (!title || !url || !content) continue;
    results.push({
      title,
      url,
      content,
      score: numberValue(item.score),
      publishedAt:
        stringValue(item.publishedAt) || stringValue(item.published_date) || null,
    });
  }
  return results;
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
