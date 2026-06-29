import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import type { AiTool } from "../contracts";
import { createOpenAiProvider } from "./openai-provider";

describe("createOpenAiProvider", () => {
  it("returns degraded without an API key and does not call fetch", async () => {
    const fetchMock = vi.fn();
    const provider = createOpenAiProvider({ apiKey: "", fetch: fetchMock });

    const result = await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    });

    expect(result).toMatchObject({
      status: "degraded",
      degradedReason: "provider_unconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Responses API text output into provider result", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output_text: "brief ready",
            usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
          }),
        ),
    );
    const provider = createOpenAiProvider({
      apiKey: "secret",
      model: "test-model",
      fetch: fetchMock,
    });

    const result = await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    });

    expect(result).toMatchObject({
      status: "succeeded",
      text: "brief ready",
      usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
  });

  it("sends deep reasoning options and user file attachments to the Responses API", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          output_text: "attachment reviewed",
          usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
        }),
      );
    });
    const provider = createOpenAiProvider({
      apiKey: "secret",
      model: "reasoning-model",
      fetch: fetchMock,
    });

    const result = await provider.runText({
      promptKey: "dashboard.ai.chat",
      promptVersion: 1,
      mode: "deep",
      reasoning: { effort: "high", summary: "auto" },
      messages: [{ role: "user", content: "read the attached finance sheet" }],
      attachments: [
        {
          name: "finance.csv",
          mimeType: "text/csv",
          data: "data:text/csv;base64,cHJvamVjdCxyZXZlbnVlCg==",
          sizeBytes: 128,
        },
      ],
    });

    expect(result.status).toBe("succeeded");
    expect(requestBody?.reasoning).toEqual({ effort: "high", summary: "auto" });
    const input = requestBody?.input as Array<Record<string, unknown>>;
    expect(input.at(-1)?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "input_text",
          text: "read the attached finance sheet",
        }),
        expect.objectContaining({
          type: "input_file",
          filename: "finance.csv",
          file_data: "data:text/csv;base64,cHJvamVjdCxyZXZlbnVlCg==",
        }),
      ]),
    );
  });

  it("parses structured JSON and never returns the API key in rawResponse", async () => {
    const provider = createOpenAiProvider({
      apiKey: "secret",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              output_text: '{"summary":"ok"}',
              usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
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

  it("sends tool definitions without executing tool handlers inside the provider", async () => {
    const handler = vi.fn();
    const tool: AiTool<unknown, unknown> = {
      name: "project_review_summary",
      description: "Read project review facts",
      inputSchema: { type: "object", properties: {} },
      scopes: ["mcn_staff"],
      masking: {},
      readOnly: true,
      handler,
    };
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          output_text: "tool planned",
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        }),
      );
    });
    const provider = createOpenAiProvider({
      apiKey: "secret",
      fetch: fetchMock,
    });

    const result = await provider.runWithTools({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "read facts" }],
      tools: [tool],
    });

    expect(requestBody?.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: "project_review_summary",
      }),
    ]);
    expect(result.status).toBe("succeeded");
    expect(handler).not.toHaveBeenCalled();
  });
});
