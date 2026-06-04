import { z } from "zod";
import { describe, expect, it } from "vitest";

import { runAiGateway } from "./llm-gateway";
import { createDeterministicProvider } from "./providers/deterministic-provider";
import type { AiProvider } from "./contracts";

describe("runAiGateway", () => {
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

  it("rejects structured output that does not match the schema", async () => {
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
      degradedReason: "schema_validation_failed",
    });
  });
});
