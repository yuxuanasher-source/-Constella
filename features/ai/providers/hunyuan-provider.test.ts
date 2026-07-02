import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHunyuanProvider } from "./hunyuan-provider";

describe("createHunyuanProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("returns degraded when key or base URL is missing", async () => {
    const fetchMock = vi.fn();
    const provider = createHunyuanProvider({
      apiKey: "",
      baseUrl: "",
      fetch: fetchMock,
    });

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

  it("maps OpenAI-compatible chat completions output into provider result", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "brief ready" } }],
            usage: {
              prompt_tokens: 9,
              completion_tokens: 4,
              total_tokens: 13,
            },
          }),
        ),
    );
    const provider = createHunyuanProvider({
      apiKey: "secret",
      baseUrl: "https://api.hunyuan.cloud.tencent.com",
      model: "test-model",
      fetch: fetchMock,
    });

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
      "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
  });

  it("parses structured JSON output from chat completions", async () => {
    const provider = createHunyuanProvider({
      apiKey: "secret",
      baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"summary":"ok"}' } }],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3,
              },
            }),
          ),
      ),
    });

    const result = await provider.runStructured({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "json" }],
      responseSchema: z.object({ summary: z.string() }),
    });

    expect(result.structuredOutput).toEqual({ summary: "ok" });
    expect(JSON.stringify(result.rawResponse)).not.toContain("secret");
  });

  it("degrades tool calls because OpenAI is the tool-calling route", async () => {
    const provider = createHunyuanProvider({
      apiKey: "secret",
      baseUrl: "https://api.hunyuan.cloud.tencent.com",
      fetch: vi.fn(),
    });

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

  it("aborts a hung request after the timeout with a fallback-friendly failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<never>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new Error("aborted")),
          );
        }),
    );
    const provider = createHunyuanProvider({
      apiKey: "secret",
      baseUrl: "https://api.hunyuan.cloud.tencent.com",
      fetch: fetchMock,
      timeoutMs: 2_000,
    });

    const pending = provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await pending;

    expect(result.status).toBe("failed");
    expect(result.errorSummary).toContain("timed out after 2000ms");
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("streams OpenAI-compatible deltas through runTextStream", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"简报"}}]}',
            "",
            'data: {"choices":[{"delta":{"content":"就绪"}}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}',
            "",
            "data: [DONE]",
            "",
          ].join("\n"),
          { status: 200 },
        ),
    );
    const provider = createHunyuanProvider({
      apiKey: "secret",
      baseUrl: "https://api.hunyuan.cloud.tencent.com",
      fetch: fetchMock,
    });

    const events = [];
    for await (const event of provider.runTextStream({
      promptKey: "dashboard.ai.chat",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "delta", text: "简报" },
      { type: "delta", text: "就绪" },
      {
        type: "done",
        result: expect.objectContaining({
          status: "succeeded",
          text: "简报就绪",
          usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
        }),
      },
    ]);
  });
});
