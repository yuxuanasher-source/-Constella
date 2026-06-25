import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { createHunyuanProvider } from "./hunyuan-provider";

describe("createHunyuanProvider", () => {
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
});
