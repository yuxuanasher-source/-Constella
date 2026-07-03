import type {
  AiCostEstimate,
  AiProviderResult,
  AiStructuredInput,
  AiTextInput,
  AiUsage,
  AiUsageEstimateInput,
} from "../contracts";
import { streamOpenAiCompatibleChat } from "./openai-compatible-stream";
import { estimateProviderCostCents } from "./provider-pricing";
import {
  createProviderTimeout,
  resolveAiProviderTimeoutMs,
  timeoutErrorSummary,
} from "./provider-timeout";
import type {
  AiProviderStreamEvent,
  AiStreamingProvider,
  StreamableFetch,
} from "./streaming-contracts";

const DEFAULT_HUNYUAN_MODEL = "hunyuan-turbos-latest";
const PROVIDER_LABEL = "Hunyuan";

type FetchLike = StreamableFetch;

type HunyuanProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
};

export function createHunyuanProvider({
  apiKey,
  baseUrl,
  model = process.env.HUNYUAN_MODEL ?? DEFAULT_HUNYUAN_MODEL,
  fetch: fetchImpl = fetch,
  timeoutMs = resolveAiProviderTimeoutMs(),
}: HunyuanProviderConfig = {}): AiStreamingProvider {
  return {
    name: "hunyuan",
    capabilities: ["text", "structured", "shadow"],
    runText(input: AiTextInput) {
      return runHunyuanRequest({
        apiKey,
        baseUrl,
        fetchImpl,
        input,
        model,
        timeoutMs,
      });
    },
    runTextStream(input: AiTextInput) {
      return streamHunyuanText({
        apiKey,
        baseUrl,
        fetchImpl,
        input,
        model,
        timeoutMs,
      });
    },
    runStructured(input: AiStructuredInput) {
      return runHunyuanRequest({
        apiKey,
        baseUrl,
        fetchImpl,
        input: withJsonInstruction(input),
        model,
        structured: true,
        timeoutMs,
      });
    },
    runWithTools() {
      return Promise.resolve(degraded("capability_unavailable"));
    },
    estimateCost(input: AiUsageEstimateInput): AiCostEstimate {
      return { costCents: estimateCostCents(input) };
    },
  };
}

async function* streamHunyuanText({
  apiKey,
  baseUrl,
  fetchImpl,
  input,
  model,
  timeoutMs,
}: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl: FetchLike;
  input: AiTextInput;
  model: string;
  timeoutMs: number;
}): AsyncGenerator<AiProviderStreamEvent, void, unknown> {
  if (!apiKey?.trim() || !baseUrl?.trim()) {
    yield {
      type: "error",
      errorSummary: "Hunyuan provider is not configured",
    };
    return;
  }

  // 混元 OpenAI 兼容接口与 DeepSeek 同形态，直接复用共享流式解析。
  yield* streamOpenAiCompatibleChat({
    url: toChatCompletionsUrl(baseUrl),
    apiKey,
    fetchImpl,
    timeoutMs,
    providerLabel: PROVIDER_LABEL,
    requestBody: {
      model,
      messages: input.messages.map((message) => ({
        role: message.role === "tool" ? "user" : message.role,
        content: message.content,
      })),
      metadata: input.metadata,
    },
  });
}

async function runHunyuanRequest({
  apiKey,
  baseUrl,
  fetchImpl,
  input,
  model,
  structured = false,
  timeoutMs,
}: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl: FetchLike;
  input: AiTextInput;
  model: string;
  structured?: boolean;
  timeoutMs: number;
}): Promise<AiProviderResult> {
  if (!apiKey?.trim() || !baseUrl?.trim()) {
    return degraded("provider_unconfigured");
  }

  const startedAt = Date.now();
  // 超时中止后 fetch 会拒绝，走 catch 返回 failed → llm-gateway 顺序切换下一个 provider。
  const timeout = createProviderTimeout(timeoutMs, PROVIDER_LABEL);

  try {
    const response = await fetchImpl(toChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: input.messages.map((message) => ({
          role: message.role === "tool" ? "user" : message.role,
          content: message.content,
        })),
        metadata: input.metadata,
      }),
      signal: timeout.signal,
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

    const text = extractChatText(raw);
    const usage = mapHunyuanUsage(raw.usage);

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
      usage,
      latencyMs,
      rawResponse: sanitizeRawResponse(raw),
    });
  } catch (error) {
    return failed({
      errorSummary: timeoutErrorSummary({
        timeout,
        timeoutMs,
        label: PROVIDER_LABEL,
        error,
        fallbackMessage: "Hunyuan request failed",
      }),
      latencyMs: Date.now() - startedAt,
    });
  } finally {
    timeout.clear();
  }
}

function toChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
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

function extractChatText(raw: Record<string, unknown>): string {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const firstChoice = choices.find(isRecord);
  const message = isRecord(firstChoice?.message)
    ? firstChoice.message
    : undefined;
  return typeof message?.content === "string" ? message.content : "";
}

function mapHunyuanUsage(usage: unknown): AiUsage {
  if (!isRecord(usage)) {
    return emptyUsage();
  }

  const promptTokens = nonnegativeInt(usage.prompt_tokens);
  const completionTokens = nonnegativeInt(usage.completion_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens:
      nonnegativeInt(usage.total_tokens) || promptTokens + completionTokens,
  };
}

function parseJsonObject(
  text: string,
): { ok: true; value: unknown } | { ok: false; errorSummary: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, errorSummary: "Provider returned invalid JSON" };
  }
}

function sanitizeRawResponse(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const { error, choices, usage, id, model } = raw;
  return { error, choices, usage, id, model };
}

function providerError(
  raw: Record<string, unknown>,
  response: Pick<Response, "status" | "statusText">,
): string {
  if (isRecord(raw.error) && typeof raw.error.message === "string") {
    return raw.error.message;
  }
  return `Hunyuan request failed with ${response.status} ${response.statusText}`;
}

function succeeded({
  text,
  structuredOutput,
  usage,
  latencyMs,
  rawResponse,
}: {
  text?: string;
  structuredOutput?: unknown;
  usage: AiUsage;
  latencyMs: number;
  rawResponse: unknown;
}): AiProviderResult {
  return {
    status: "succeeded",
    text,
    structuredOutput,
    toolCalls: [],
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
  return estimateProviderCostCents("hunyuan", input);
}

function nonnegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
