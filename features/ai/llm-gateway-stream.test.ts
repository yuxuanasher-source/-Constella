import { describe, expect, it, vi } from "vitest";

import type { AiProvider, AiProviderResult } from "./contracts";
import { runAiGatewayStream, type AiGatewayStreamEvent } from "./llm-gateway-stream";
import { createDeterministicProvider } from "./providers/deterministic-provider";
import type {
  AiProviderStreamEvent,
  AiStreamingProvider,
} from "./providers/streaming-contracts";

const textRequest = {
  promptKey: "dashboard.ai.chat",
  promptVersion: 1,
  messages: [{ role: "user" as const, content: "summarize" }],
};

function usage(totalTokens = 5) {
  return { promptTokens: 2, completionTokens: 3, totalTokens };
}

function succeededResult(text: string): AiProviderResult {
  return {
    status: "succeeded",
    text,
    toolCalls: [],
    usage: usage(),
    latencyMs: 10,
    costCents: 1,
  };
}

function streamingProvider(
  name: AiStreamingProvider["name"],
  events: AiProviderStreamEvent[],
): AiStreamingProvider {
  return {
    name,
    capabilities: ["text"],
    async runText() {
      throw new Error("not used in streaming test");
    },
    async *runTextStream() {
      for (const event of events) {
        yield event;
      }
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
}

async function collect(
  iterator: AsyncGenerator<AiGatewayStreamEvent, void, unknown>,
): Promise<AiGatewayStreamEvent[]> {
  const events: AiGatewayStreamEvent[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
}

describe("runAiGatewayStream", () => {
  it("streams deltas and a final done result from the primary provider", async () => {
    const events = await collect(
      runAiGatewayStream({
        providers: [
          streamingProvider("deepseek", [
            { type: "delta", text: "你" },
            { type: "delta", text: "好" },
            { type: "done", result: succeededResult("你好") },
          ]),
        ],
        primaryProvider: "deepseek",
        request: textRequest,
      }),
    );

    expect(events).toEqual([
      { type: "delta", text: "你", providerName: "deepseek", fallbackUsed: false },
      { type: "delta", text: "好", providerName: "deepseek", fallbackUsed: false },
      {
        type: "done",
        result: expect.objectContaining({
          status: "succeeded",
          text: "你好",
          providerName: "deepseek",
          fallbackUsed: false,
        }),
      },
    ]);
  });

  it("falls back to the next provider when the stream fails before the first delta", async () => {
    const events = await collect(
      runAiGatewayStream({
        providers: [
          streamingProvider("deepseek", [
            { type: "error", errorSummary: "DeepSeek request timed out after 30000ms" },
          ]),
          streamingProvider("hunyuan", [
            { type: "delta", text: "fallback answer" },
            { type: "done", result: succeededResult("fallback answer") },
          ]),
        ],
        primaryProvider: "deepseek",
        request: textRequest,
      }),
    );

    expect(events).toEqual([
      {
        type: "delta",
        text: "fallback answer",
        providerName: "hunyuan",
        fallbackUsed: true,
      },
      {
        type: "done",
        result: expect.objectContaining({
          status: "succeeded",
          providerName: "hunyuan",
          fallbackUsed: true,
          degradedReason: "primary_failed",
        }),
      },
    ]);
  });

  it("emits a terminal error without switching providers once the stream has started", async () => {
    const untouchedFallback = streamingProvider("hunyuan", [
      { type: "delta", text: "should never stream" },
      { type: "done", result: succeededResult("should never stream") },
    ]);
    const runTextStreamSpy = vi.spyOn(untouchedFallback, "runTextStream");

    const events = await collect(
      runAiGatewayStream({
        providers: [
          streamingProvider("deepseek", [
            { type: "delta", text: "部分回复" },
            { type: "error", errorSummary: "connection reset" },
          ]),
          untouchedFallback,
        ],
        primaryProvider: "deepseek",
        request: textRequest,
      }),
    );

    expect(events).toEqual([
      {
        type: "delta",
        text: "部分回复",
        providerName: "deepseek",
        fallbackUsed: false,
      },
      {
        type: "error",
        streamStarted: true,
        result: expect.objectContaining({
          status: "failed",
          providerName: "deepseek",
          degradedReason: "stream_interrupted",
          errorSummary: "connection reset",
        }),
      },
    ]);
    expect(runTextStreamSpy).not.toHaveBeenCalled();
  });

  it("adapts non-streaming providers into a single delta plus done", async () => {
    const events = await collect(
      runAiGatewayStream({
        providers: [
          streamingProvider("deepseek", [
            { type: "error", errorSummary: "upstream 500" },
          ]),
          createDeterministicProvider() as AiProvider,
        ],
        primaryProvider: "deepseek",
        request: textRequest,
      }),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "delta",
      providerName: "deterministic",
      fallbackUsed: true,
    });
    expect(events[1]).toMatchObject({
      type: "done",
      result: expect.objectContaining({
        status: "succeeded",
        providerName: "deterministic",
        fallbackUsed: true,
        degradedReason: "primary_failed",
      }),
    });
  });

  it("emits a terminal error with all failures when every provider fails before streaming", async () => {
    const events = await collect(
      runAiGatewayStream({
        providers: [
          streamingProvider("deepseek", [
            { type: "error", errorSummary: "deepseek timeout" },
          ]),
          streamingProvider("hunyuan", [
            { type: "error", errorSummary: "hunyuan 500" },
          ]),
        ],
        primaryProvider: "deepseek",
        request: textRequest,
      }),
    );

    expect(events).toEqual([
      {
        type: "error",
        streamStarted: false,
        result: expect.objectContaining({
          status: "failed",
          degradedReason: "all_providers_failed",
          errorSummary: "deepseek timeout; hunyuan 500",
          fallbackUsed: true,
        }),
      },
    ]);
  });

  it("treats a done event with empty text before any delta as a provider failure", async () => {
    const events = await collect(
      runAiGatewayStream({
        providers: [
          streamingProvider("deepseek", [
            { type: "done", result: succeededResult("") },
          ]),
          streamingProvider("hunyuan", [
            { type: "delta", text: "backup" },
            { type: "done", result: succeededResult("backup") },
          ]),
        ],
        primaryProvider: "deepseek",
        request: textRequest,
      }),
    );

    expect(events[0]).toMatchObject({
      type: "delta",
      providerName: "hunyuan",
      fallbackUsed: true,
    });
    expect(events[1]).toMatchObject({
      type: "done",
      result: expect.objectContaining({ providerName: "hunyuan" }),
    });
  });
});
