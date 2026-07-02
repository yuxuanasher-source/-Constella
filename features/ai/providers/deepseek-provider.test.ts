import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeepseekProvider } from "./deepseek-provider";
import type { AiProviderStreamEvent } from "./streaming-contracts";

function neverResolvingFetch() {
  // 模拟挂死的上游：永不 resolve，但尊重 AbortSignal。
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<never>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason ?? new Error("aborted")),
        );
      }),
  );
}

function sseResponse(lines: string[]): Response {
  return new Response(lines.join("\n"), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collectEvents(
  iterator: AsyncGenerator<AiProviderStreamEvent, void, unknown>,
): Promise<AiProviderStreamEvent[]> {
  const events: AiProviderStreamEvent[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
}

describe("createDeepseekProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("returns degraded when the API key is missing", async () => {
    const fetchMock = vi.fn();
    const provider = createDeepseekProvider({ apiKey: "", fetch: fetchMock });

    const result = await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize in Chinese" }],
    });

    expect(result).toMatchObject({
      status: "degraded",
      degradedReason: "provider_unconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the default DeepSeek endpoint and maps chat output", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "brief ready" } }],
            usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
          }),
        ),
    );
    // base/model 走默认值，只传 apiKey。
    const provider = createDeepseekProvider({ apiKey: "secret", fetch: fetchMock });

    const result = await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize in Chinese" }],
    });

    expect(result).toMatchObject({
      status: "succeeded",
      text: "brief ready",
      usage: { promptTokens: 9, completionTokens: 4, totalTokens: 13 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(requestInit.body)).model).toBe("deepseek-v4-flash");
  });

  it("uses thinking controls and the reasoning model override for deep chat requests", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "deep answer" } }],
            usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
          }),
        ),
    );
    const provider = createDeepseekProvider({
      apiKey: "secret",
      model: "deepseek-v4-flash",
      reasoningModel: "deepseek-v4-pro",
      fetch: fetchMock,
    });

    await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      mode: "deep",
      reasoning: { effort: "high", summary: "auto" },
      messages: [{ role: "user", content: "analyze deeply" }],
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const requestBody = JSON.parse(String(requestInit.body));
    expect(requestBody.model).toBe("deepseek-v4-pro");
    expect(requestBody.thinking).toEqual({ type: "enabled" });
    expect(requestBody.reasoning_effort).toBe("high");
    expect(requestBody.metadata.chatMode).toBe("deep");
  });

  it("disables thinking for fast chat requests", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "fast answer" } }],
            usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
          }),
        ),
    );
    const provider = createDeepseekProvider({
      apiKey: "secret",
      model: "deepseek-v4-flash",
      fetch: fetchMock,
    });

    await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      mode: "fast",
      messages: [{ role: "user", content: "answer quickly" }],
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const requestBody = JSON.parse(String(requestInit.body));
    expect(requestBody.model).toBe("deepseek-v4-flash");
    expect(requestBody.thinking).toEqual({ type: "disabled" });
    expect(requestBody).not.toHaveProperty("reasoning_effort");
  });

  it("requests json_object and parses structured output", async () => {
    let sentBody = "";
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) => {
        sentBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"summary":"ok"}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        );
      },
    );
    const provider = createDeepseekProvider({
      apiKey: "secret",
      model: "deepseek-v4-flash",
      fetch: fetchMock,
    });

    const result = await provider.runStructured({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "json" }],
      responseSchema: z.object({ summary: z.string() }),
    });

    expect(result.structuredOutput).toEqual({ summary: "ok" });
    expect(JSON.stringify(result.rawResponse)).not.toContain("secret");
    expect(JSON.parse(sentBody).response_format).toEqual({ type: "json_object" });
  });

  it("degrades tool calls (chat-completions route has no tools)", async () => {
    const provider = createDeepseekProvider({ apiKey: "secret", fetch: vi.fn() });
    const result = await provider.runWithTools({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "use tools" }],
      tools: [],
    });
    expect(result).toMatchObject({
      status: "degraded",
      degradedReason: "capability_unavailable",
    });
  });

  it("passes an AbortSignal to fetch so hung upstreams can be cancelled", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        ),
    );
    const provider = createDeepseekProvider({ apiKey: "secret", fetch: fetchMock });

    await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails with a timeout summary (fallback-friendly) when the upstream hangs", async () => {
    vi.useFakeTimers();
    const fetchMock = neverResolvingFetch();
    const provider = createDeepseekProvider({
      apiKey: "secret",
      fetch: fetchMock,
      timeoutMs: 1_000,
    });

    const pending = provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    // failed（而非 throw）能被 llm-gateway 的 fallback 循环捕获并切换 provider。
    expect(result.status).toBe("failed");
    expect(result.errorSummary).toContain("timed out after 1000ms");
  });

  it("streams delta chunks and a final done result with usage", async () => {
    let sentBody = "";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"好"}}]}',
        "",
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
        "",
        "data: [DONE]",
        "",
      ]);
    });
    const provider = createDeepseekProvider({ apiKey: "secret", fetch: fetchMock });

    const events = await collectEvents(
      provider.runTextStream({
        promptKey: "dashboard.ai.chat",
        promptVersion: 1,
        messages: [{ role: "user", content: "打个招呼" }],
      }),
    );

    expect(events).toEqual([
      { type: "delta", text: "你" },
      { type: "delta", text: "好" },
      {
        type: "done",
        result: expect.objectContaining({
          status: "succeeded",
          text: "你好",
          usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
        }),
      },
    ]);
    const requestBody = JSON.parse(sentBody);
    expect(requestBody.stream).toBe(true);
    expect(requestBody.stream_options).toEqual({ include_usage: true });
  });

  it("emits an error event (before any delta) when the streaming request fails", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
          status: 429,
          statusText: "Too Many Requests",
        }),
    );
    const provider = createDeepseekProvider({ apiKey: "secret", fetch: fetchMock });

    const events = await collectEvents(
      provider.runTextStream({
        promptKey: "dashboard.ai.chat",
        promptVersion: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(events).toEqual([
      { type: "error", errorSummary: "quota exceeded" },
    ]);
  });
});
