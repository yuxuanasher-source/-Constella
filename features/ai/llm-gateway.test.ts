import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAiGateway } from "./llm-gateway";
import { createDeepseekProvider } from "./providers/deepseek-provider";
import { createDeterministicProvider } from "./providers/deterministic-provider";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "./provider-registry";
import type { AiProvider } from "./contracts";

describe("runAiGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to the next provider when the primary times out", async () => {
    vi.useFakeTimers();
    // 挂死的上游：永不 resolve，只尊重 AbortSignal —— 验证超时错误
    // 能被 fallback 循环捕获并切到下一个 provider，而不是吊死路由。
    const hangingFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<never>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new Error("aborted")),
          );
        }),
    );

    const pending = runAiGateway({
      providers: [
        createDeepseekProvider({
          apiKey: "secret",
          fetch: hangingFetch,
          timeoutMs: 1_000,
        }),
        createDeterministicProvider(),
      ],
      primaryProvider: "deepseek",
      request: {
        kind: "text",
        promptKey: "ops.brief",
        promptVersion: 1,
        messages: [{ role: "user", content: "summarize" }],
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result).toMatchObject({
      status: "succeeded",
      providerName: "deterministic",
      fallbackUsed: true,
      degradedReason: "primary_failed",
    });
  });

  it("returns degraded when no provider supports the request", async () => {
    await expect(
      runAiGateway({
        providers: [],
        request: {
          kind: "text",
          promptKey: "ops.brief",
          promptVersion: 1,
          messages: [{ role: "user", content: "summarize" }],
        },
      }),
    ).resolves.toMatchObject({
      status: "degraded",
      degradedReason: "provider_unconfigured",
    });
  });

  it("falls back when the primary provider fails", async () => {
    const failingProvider: AiProvider = {
      name: "openai",
      capabilities: ["text", "structured", "tools"],
      async runText() {
        return {
          status: "failed",
          errorSummary: "upstream timeout",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latencyMs: 1000,
          costCents: 0,
        };
      },
      async runStructured() {
        throw new Error("not used");
      },
      async runWithTools() {
        throw new Error("not used");
      },
      estimateCost() {
        return { costCents: 0 };
      },
    };

    const result = await runAiGateway({
      providers: [failingProvider, createDeterministicProvider()],
      primaryProvider: "openai",
      request: {
        kind: "text",
        promptKey: "ops.brief",
        promptVersion: 1,
        messages: [{ role: "user", content: "summarize" }],
      },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerName: "deterministic",
      fallbackUsed: true,
      degradedReason: "primary_failed",
    });
  });

  it("returns all provider failed when structured output does not match the schema", async () => {
    const result = await runAiGateway({
      providers: [
        createDeterministicProvider({
          structuredOutput: { summary: 123 },
        }),
      ],
      request: {
        kind: "structured",
        promptKey: "ops.brief",
        promptVersion: 1,
        messages: [{ role: "user", content: "summarize" }],
        responseSchema: z.object({ summary: z.string() }),
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      providerName: "deterministic",
      degradedReason: "all_providers_failed",
    });
    expect(result.errorSummary).toContain("schema validation failed");
  });

  it("falls back when the primary structured provider returns schema-invalid output", async () => {
    const schemaInvalidProvider: AiProvider = {
      name: "openai",
      capabilities: ["structured"],
      async runText() {
        throw new Error("not used");
      },
      async runStructured() {
        return {
          status: "succeeded",
          structuredOutput: { summary: 123 },
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          latencyMs: 10,
          costCents: 0,
        };
      },
      async runWithTools() {
        throw new Error("not used");
      },
      estimateCost() {
        return { costCents: 0 };
      },
    };

    const result = await runAiGateway({
      providers: [
        schemaInvalidProvider,
        createDeterministicProvider({
          structuredOutput: { summary: "fallback summary" },
        }),
      ],
      primaryProvider: "openai",
      request: {
        kind: "structured",
        promptKey: "ops.brief",
        promptVersion: 1,
        messages: [{ role: "user", content: "summarize" }],
        responseSchema: z.object({ summary: z.string() }),
      },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerName: "deterministic",
      fallbackUsed: true,
      degradedReason: "primary_failed",
      structuredOutput: { summary: "fallback summary" },
    });
  });

  it("can run from environment-backed providers through the gateway", async () => {
    const routing = resolveAiProviderRouting({});
    const result = await runAiGateway({
      providers: createConfiguredAiProviders({ env: {} }),
      primaryProvider: routing.primaryProvider,
      request: {
        kind: "text",
        promptKey: "ops.brief",
        promptVersion: 1,
        messages: [{ role: "user", content: "summarize" }],
      },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerName: "deterministic",
      fallbackUsed: false,
    });
  });
});
