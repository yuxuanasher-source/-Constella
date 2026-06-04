import type {
  AiCostEstimate,
  AiMessage,
  AiProvider,
  AiProviderResult,
  AiStructuredInput,
  AiTextInput,
  AiTool,
  AiToolRunInput,
  AiUsage,
  AiUsageEstimateInput,
} from "../contracts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "json" | "ok" | "status" | "statusText">>;

type OpenAiProviderConfig = {
  apiKey?: string;
  model?: string;
  fetch?: FetchLike;
};

export function createOpenAiProvider({
  apiKey,
  model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
  fetch: fetchImpl = fetch,
}: OpenAiProviderConfig = {}): AiProvider {
  return {
    name: "openai",
    capabilities: ["text", "structured", "tools", "shadow"],
    runText(input: AiTextInput) {
      return runOpenAiRequest({
        apiKey,
        fetchImpl,
        input,
        model,
      });
    },
    runStructured(input: AiStructuredInput) {
      return runOpenAiRequest({
        apiKey,
        fetchImpl,
        input: withJsonInstruction(input),
        model,
        structured: true,
      });
    },
    runWithTools(input: AiToolRunInput) {
      return runOpenAiRequest({
        apiKey,
        fetchImpl,
        input,
        model,
        tools: input.tools,
      });
    },
    estimateCost(input: AiUsageEstimateInput): AiCostEstimate {
      return { costCents: estimateCostCents(input) };
    },
  };
}

async function runOpenAiRequest({
  apiKey,
  fetchImpl,
  input,
  model,
  structured = false,
  tools,
}: {
  apiKey?: string;
  fetchImpl: FetchLike;
  input: AiTextInput;
  model: string;
  structured?: boolean;
  tools?: Array<AiTool<unknown, unknown>>;
}): Promise<AiProviderResult> {
  if (!apiKey?.trim()) {
    return degraded("provider_unconfigured");
  }

  const startedAt = Date.now();

  try {
    const response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: toResponsesInput(input.messages),
        metadata: input.metadata,
        ...(tools?.length ? { tools: tools.map(toOpenAiTool) } : {}),
      }),
    });
    const raw = (await response.json()) as Record<string, unknown>;
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return failed({
        errorSummary: providerError(raw, response),
        latencyMs,
        rawResponse: sanitizeRawResponse(raw),
      });
    }

    const text = extractOpenAiText(raw);
    const usage = mapOpenAiUsage(raw.usage);

    if (structured) {
      const parsed = parseJsonObject(text);
      if (!parsed.ok) {
        return failed({
          errorSummary: parsed.errorSummary,
          latencyMs,
          rawResponse: sanitizeRawResponse(raw),
          usage,
        });
      }

      return succeeded({
        structuredOutput: parsed.value,
        usage,
        latencyMs,
        rawResponse: sanitizeRawResponse(raw),
      });
    }

    return succeeded({
      text,
      structuredOutput: tools?.length ? parseJsonObject(text).value : undefined,
      toolCalls: extractOpenAiToolCalls(raw),
      usage,
      latencyMs,
      rawResponse: sanitizeRawResponse(raw),
    });
  } catch (error) {
    return failed({
      errorSummary: error instanceof Error ? error.message : "OpenAI request failed",
      latencyMs: Date.now() - startedAt,
    });
  }
}

function toResponsesInput(messages: AiMessage[]): Array<Record<string, string>> {
  return messages.map((message) => ({
    role: message.role === "tool" ? "user" : message.role,
    content: message.content,
  }));
}

function toOpenAiTool(tool: AiTool<unknown, unknown>): Record<string, unknown> {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: normalizeSchemaObject(tool.inputSchema),
  };
}

function withJsonInstruction<T extends AiStructuredInput>(input: T): T {
  return {
    ...input,
    messages: [
      ...input.messages,
      {
        role: "system",
        content: "Return only valid JSON that matches the requested schema.",
      },
    ],
  };
}

function extractOpenAiText(raw: Record<string, unknown>): string {
  if (typeof raw.output_text === "string") {
    return raw.output_text;
  }

  const output = Array.isArray(raw.output) ? raw.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join("\n");
}

function extractOpenAiToolCalls(raw: Record<string, unknown>): unknown[] {
  const output = Array.isArray(raw.output) ? raw.output : [];
  return output.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item.type === "function_call",
  );
}

function mapOpenAiUsage(usage: unknown): AiUsage {
  if (!isRecord(usage)) {
    return emptyUsage();
  }

  const promptTokens = nonnegativeInt(usage.input_tokens);
  const completionTokens = nonnegativeInt(usage.output_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: nonnegativeInt(usage.total_tokens) || promptTokens + completionTokens,
  };
}

function normalizeSchemaObject(schema: unknown): Record<string, unknown> {
  return isRecord(schema) ? schema : { type: "object", properties: {} };
}

function parseJsonObject(text: string): { ok: true; value: unknown } | { ok: false; errorSummary: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, errorSummary: "Provider returned invalid JSON" };
  }
}

function sanitizeRawResponse(raw: Record<string, unknown>): Record<string, unknown> {
  const { error, output, output_text, usage, id, model } = raw;
  return { error, output, output_text, usage, id, model };
}

function providerError(
  raw: Record<string, unknown>,
  response: Pick<Response, "status" | "statusText">,
): string {
  if (isRecord(raw.error) && typeof raw.error.message === "string") {
    return raw.error.message;
  }
  return `OpenAI request failed with ${response.status} ${response.statusText}`;
}

function succeeded({
  text,
  structuredOutput,
  toolCalls = [],
  usage,
  latencyMs,
  rawResponse,
}: {
  text?: string;
  structuredOutput?: unknown;
  toolCalls?: unknown[];
  usage: AiUsage;
  latencyMs: number;
  rawResponse: unknown;
}): AiProviderResult {
  return {
    status: "succeeded",
    text,
    structuredOutput,
    toolCalls,
    usage,
    latencyMs,
    costCents: estimateCostCents({
      kind: structuredOutput === undefined ? "text" : "structured",
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    }),
    rawResponse,
  };
}

function failed({
  errorSummary,
  latencyMs,
  rawResponse = {},
  usage = emptyUsage(),
}: {
  errorSummary: string;
  latencyMs: number;
  rawResponse?: unknown;
  usage?: AiUsage;
}): AiProviderResult {
  return {
    status: "failed",
    errorSummary,
    usage,
    latencyMs,
    costCents: 0,
    rawResponse,
  };
}

function degraded(reason: string): AiProviderResult {
  return {
    status: "degraded",
    degradedReason: reason,
    usage: emptyUsage(),
    latencyMs: 0,
    costCents: 0,
  };
}

function emptyUsage(): AiUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function estimateCostCents(input: AiUsageEstimateInput): number {
  const tokens = nonnegativeInt(input.promptTokens) + nonnegativeInt(input.completionTokens);
  return tokens > 0 ? Math.max(1, Math.ceil(tokens / 1000)) : 0;
}

function nonnegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
