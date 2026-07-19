export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  sourceQuery?: string;
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
              max_results: maxResults,
            },
          },
        }),
      });
      if (!response.ok) {
        const body = response.text ? await response.text() : "";
        throw new Error(
          `AnySearch search failed: ${response.status} ${body}`.trim(),
        );
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
        throw new Error(
          `Tavily search failed: ${response.status} ${body}`.trim(),
        );
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
    const url = safeSearchResultUrl(stringValue(item.url));
    const content = stringValue(item.content);
    if (!title || !url || !content) continue;
    results.push({
      title,
      url,
      content,
      score: numberValue(item.score),
      publishedAt:
        stringValue(item.publishedAt) ||
        stringValue(item.published_date) ||
        null,
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
  if (result.isError === true) {
    throw new Error(
      `AnySearch search failed: ${anySearchErrorMessage(result.content)}`,
    );
  }
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
  return normalizeAnySearchMarkdown(text);
}

function normalizeAnySearchMarkdown(text: string): WebSearchResult[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s*search results\b/i.test(line)) continue;
    if (isAnySearchResultStart(line) && current.length) {
      blocks.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);

  return blocks
    .map(parseAnySearchMarkdownBlock)
    .filter((result): result is WebSearchResult => Boolean(result));
}

function isAnySearchResultStart(line: string): boolean {
  const text = line.replace(/^[-*]\s+/, "").trim();
  if (/^#{1,6}\s*(?!search results\b)(?:\d+[\.)]\s*)?/i.test(text)) {
    return true;
  }
  if (/^\d+[\.)]\s+/.test(text)) return true;
  return /^\[.+?\]\(https?:\/\/.+?\)/i.test(text);
}

function parseAnySearchMarkdownBlock(lines: string[]): WebSearchResult | null {
  const firstLine = lines[0] ?? "";
  const blockText = lines.join("\n");
  const markdownLink = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/i.exec(blockText);
  const url = safeSearchResultUrl(
    cleanUrl(
      fieldValue(blockText, "url") ||
        fieldValue(blockText, "link") ||
        markdownLink?.[2] ||
        "",
    ),
  );
  if (!url) return null;

  const title = cleanMarkdown(
    (markdownLink?.[1] || titleFromAnySearchLine(firstLine) || "")
      .replace(url, "")
      .replace(/(?:[-\u2013\u2014]\s*)?\*{0,2}URL\*{0,2}\s*:?\s*$/i, ""),
  );
  const content = contentFromAnySearchLines(lines, title, url);
  if (!title || !content) return null;

  return {
    title,
    url,
    content,
    publishedAt:
      fieldValue(blockText, "published") ||
      fieldValue(blockText, "publishedAt") ||
      fieldValue(blockText, "date") ||
      null,
  };
}

function titleFromAnySearchLine(line: string): string {
  return cleanMarkdown(
    line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+[\.)]\s+/, "")
      .replace(/\s+(?:[-\u2013\u2014]\s*)?\*{0,2}URL\*{0,2}\s*:.+$/i, ""),
  );
}

function contentFromAnySearchLines(
  lines: string[],
  title: string,
  url: string,
): string {
  const parts: string[] = [];
  for (const line of lines) {
    const snippet =
      fieldValue(line, "snippet") ||
      fieldValue(line, "content") ||
      fieldValue(line, "description") ||
      fieldValue(line, "summary");
    if (snippet) {
      parts.push(snippet);
      continue;
    }
    const cleaned = cleanMarkdown(line.replace(url, ""));
    if (!cleaned || cleaned === title) continue;
    if (/^(url|link|published|publishedAt|date)\s*:/i.test(cleaned)) continue;
    if (/\b(url|link)\s*:?\s*$/i.test(cleaned)) continue;
    if (/^search results\b/i.test(cleaned)) continue;
    parts.push(cleaned);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function fieldValue(text: string, field: string): string {
  const pattern = new RegExp(
    `(?:^|[\\n\\r\\-*>\\s])\\*{0,2}${escapeRegExp(field)}\\*{0,2}\\s*:\\s*([^\\n\\r]+)`,
    "i",
  );
  const match = pattern.exec(text);
  return match ? cleanMarkdown(match[1] ?? "") : "";
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\d+[\.)]\s+/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function cleanUrl(value: string): string {
  return value.trim().replace(/[),.;]+$/g, "");
}

function safeSearchResultUrl(value: string): string {
  const text = value.trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? text
      : "";
  } catch {
    return "";
  }
}

function anySearchErrorMessage(content: unknown[]): string {
  for (const item of content) {
    if (!isRecord(item) || item.type !== "text") continue;
    const text = stringValue(item.text);
    if (text) return text.split(/\r?\n/)[0] || text;
  }
  return "unknown error";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const url = safeSearchResultUrl(
      stringValue(item.url) || stringValue(item.link),
    );
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
        stringValue(item.publishedAt) ||
        stringValue(item.published_date) ||
        null,
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
