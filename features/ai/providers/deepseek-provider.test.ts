import { describe, expect, it, vi } from "vitest";

import {
  createDeepSeekProvider,
  readDeepSeekConfigFromEnv,
} from "./deepseek-provider";

function requestBody(fetchImpl: {
  mock: { calls: unknown[][] };
}): Record<string, unknown> {
  const call = fetchImpl.mock.calls[0] as [string, { body: string }];
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

function chatResponse(
  content: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "chatcmpl-1",
      object: "chat.completion",
      model: "deepseek-chat",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        total_tokens: 2_000_000,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 1_000_000,
      },
      ...overrides,
    }),
  };
}

describe("createDeepSeekProvider", () => {
  it("calls the OpenAI-compatible endpoint with a Bearer token", async () => {
    const fetchImpl = vi.fn(async () => chatResponse("直播复盘建议：维持"));
    let tick = 0;
    const provider = createDeepSeekProvider({
      apiKey: "sk-test",
      model: "deepseek-chat",
      temperature: 0.2,
      fetchImpl,
      now: () => new Date(1_000 + tick++ * 250),
    });

    const result = await provider.runText({
      promptKey: "project_review",
      promptVersion: 1,
      messages: [
        { role: "system", content: "你是经营舱助手" },
        { role: "user", content: "总结这个项目" },
      ],
    });

    expect(result).toMatchObject({
      status: "succeeded",
      text: "直播复盘建议：维持",
      latencyMs: 250,
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
    });
    // 100 万 cache-miss 输入 (27 分) + 100 万输出 (110 分) = 137 分
    expect(result.costCents).toBeCloseTo(137, 5);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        }),
      }),
    );
    expect(requestBody(fetchImpl)).toMatchObject({
      model: "deepseek-chat",
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "system", content: "你是经营舱助手" },
        { role: "user", content: "总结这个项目" },
      ],
    });
  });

  it("requests JSON output and parses structured responses", async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse('{"shouldContinue": true, "marginRateBps": 1200}'),
    );
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    const result = await provider.runStructured({
      promptKey: "project_review",
      promptVersion: 1,
      messages: [{ role: "user", content: "输出 JSON" }],
    });

    expect(result.status).toBe("succeeded");
    expect(result.structuredOutput).toEqual({
      shouldContinue: true,
      marginRateBps: 1200,
    });
    expect(requestBody(fetchImpl).response_format).toEqual({
      type: "json_object",
    });
  });

  it("fails when structured output is not valid JSON", async () => {
    const fetchImpl = vi.fn(async () => chatResponse("not json"));
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    const result = await provider.runStructured({
      promptKey: "project_review",
      promptVersion: 1,
      messages: [{ role: "user", content: "输出 JSON" }],
    });

    expect(result).toMatchObject({
      status: "failed",
      degradedReason: "structured_output_unparsable",
    });
  });

  it("maps gateway tools into OpenAI function definitions", async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse("", {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "lookup", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    const result = await provider.runWithTools({
      promptKey: "diagnosis",
      promptVersion: 1,
      messages: [{ role: "user", content: "查一下" }],
      tools: [
        {
          name: "lookup",
          description: "查询数据",
          inputSchema: { type: "object", required: ["id"] },
          scopes: ["mcn_staff"],
          masking: {},
          readOnly: true,
          handler: () => ({}),
        },
      ],
    });

    expect(result.status).toBe("succeeded");
    expect(result.toolCalls).toHaveLength(1);
    const body = requestBody(fetchImpl);
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "lookup",
          description: "查询数据",
          parameters: { type: "object", required: ["id"] },
        },
      },
    ]);
  });

  it("returns degraded when the API key is not configured", async () => {
    const fetchImpl = vi.fn();
    const provider = createDeepSeekProvider({ apiKey: "", fetchImpl });

    await expect(
      provider.runText({
        promptKey: "project_review",
        promptVersion: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).resolves.toMatchObject({
      status: "degraded",
      degradedReason: "provider_unconfigured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces API error messages on non-2xx responses", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({
        error: {
          message: "Insufficient Balance",
          type: "insufficient_balance",
        },
      }),
    }));
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    await expect(
      provider.runText({
        promptKey: "project_review",
        promptVersion: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorSummary: "Insufficient Balance",
    });
  });

  it("reads config from env with sensible defaults", () => {
    expect(readDeepSeekConfigFromEnv({ DEEPSEEK_API_KEY: "sk-env" })).toEqual({
      apiKey: "sk-env",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
    });
    expect(
      readDeepSeekConfigFromEnv({
        DEEPSEEK_API_KEY: "sk-env",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com/beta",
        DEEPSEEK_MODEL: "deepseek-reasoner",
      }),
    ).toEqual({
      apiKey: "sk-env",
      baseUrl: "https://api.deepseek.com/beta",
      model: "deepseek-reasoner",
    });
  });
});

const realSmoke = process.env.DEEPSEEK_API_KEY ? it : it.skip;

realSmoke("real DeepSeek env-gated smoke", async () => {
  const provider = createDeepSeekProvider(
    readDeepSeekConfigFromEnv(process.env),
  );

  const result = await provider.runText({
    promptKey: "smoke",
    promptVersion: 1,
    messages: [{ role: "user", content: "用一句话介绍你自己" }],
  });

  expect(["succeeded", "failed", "degraded"]).toContain(result.status);
  expect(JSON.stringify(result)).not.toContain(process.env.DEEPSEEK_API_KEY);
});
