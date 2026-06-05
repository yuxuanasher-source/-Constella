import type {
  AiCostEstimate,
  AiProvider,
  AiProviderResult,
  AiStructuredInput,
  AiTextInput,
  AiToolRunInput,
  AiUsageEstimateInput,
} from "../contracts";

type DeterministicFixtures = {
  text?: string;
  structuredOutput?: unknown;
};

export function createDeterministicProvider(
  fixtures: DeterministicFixtures = {},
): AiProvider {
  return {
    name: "deterministic",
    capabilities: ["text", "structured", "tools", "shadow"],
    async runText(input: AiTextInput): Promise<AiProviderResult> {
      return succeeded({
        text:
          fixtures.text ??
          lastMessage(input.messages) ??
          "deterministic response",
        rawResponse: { provider: "deterministic" },
      });
    },
    async runStructured(input: AiStructuredInput): Promise<AiProviderResult> {
      return succeeded({
        structuredOutput: fixtures.structuredOutput ?? {
          summary: lastMessage(input.messages) ?? "deterministic response",
        },
        rawResponse: { provider: "deterministic" },
      });
    },
    async runWithTools(input: AiToolRunInput): Promise<AiProviderResult> {
      return succeeded({
        structuredOutput: fixtures.structuredOutput ?? {
          toolCount: input.tools.length,
          summary: lastMessage(input.messages) ?? "deterministic tool response",
        },
        toolCalls: [],
        rawResponse: { provider: "deterministic" },
      });
    },
    estimateCost(input: AiUsageEstimateInput): AiCostEstimate {
      return {
        costCents:
          estimateTokens(input.promptTokens, input.completionTokens) > 0
            ? 1
            : 0,
      };
    },
  };
}

function succeeded(
  result: Pick<
    AiProviderResult,
    "text" | "structuredOutput" | "toolCalls" | "rawResponse"
  >,
): AiProviderResult {
  return {
    status: "succeeded",
    ...result,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    latencyMs: 0,
    costCents: 0,
  };
}

function lastMessage(messages: AiTextInput["messages"]): string | undefined {
  return messages.at(-1)?.content;
}

function estimateTokens(promptTokens = 0, completionTokens = 0): number {
  return Math.max(0, promptTokens) + Math.max(0, completionTokens);
}
