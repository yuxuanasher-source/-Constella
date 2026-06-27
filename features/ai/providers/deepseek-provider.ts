import type {
  AiCostEstimate,
  AiProvider,
  AiProviderResult,
  AiStructuredInput,
  AiTextInput,
  AiUsage,
  AiUsageEstimateInput,
} from "../contracts";

// DeepSeek 走 OpenAI 兼容的 chat/completions 接口（与混元同形态）。
// 默认 base/model 已内置，故只需配置 DEEPSEEK_API_KEY 即可启用。
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "json" | "ok" | "status" | "statusText">>;

type DeepseekProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: FetchLike;
};

export function createDeepseekProvider({
  apiKey,
  baseUrl = process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL,
  model = process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
  fetch: fetchImpl = fetch,
}: DeepseekProviderConfig = {}): AiProvider {
  return {
    name: "deepseek",
    capabilities: ["text", "structured", "shadow"],
    runText(input: AiTextInput) {
      return runDeepseekRequest({ apiKey, baseUrl, fetchImpl, input, model });
    },
    runStructured(input: AiStructuredInput) {
      return runDeepseekRequest({
        apiKey,
        baseUrl,
        fetchImpl,
        input: withJsonInstruction(input),
        model,
        structured: true,
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

async function runDeepseekRequest({
  apiKey,
  baseUrl,
  fetchImpl,
  input,
  model,
  structured = false,
}: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl: FetchLike;
  input: AiTextInput;
  model: string;
  structured?: boolean;
}): Promise<AiProviderResult> {
  if (!apiKey?.trim() || !baseUrl?.trim()) {
    return degraded("provider_unconfigured");
  }

  const startedAt = Date.now();

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
        stream: false,
        // DeepSeek 支持 OpenAI 的 JSON 模式，结构化时请求 json_object。
        ...(structured ? { response_format: { type: "json_object" } } : {}),
        metadata: input.metadata,
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

    const text = extractChatText(raw);
    const usage = mapUsage(raw.usage);

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
      errorSummary:
        error instanceof Error ? error.message : "DeepSeek request failed",
      latencyMs: Date.now() - startedAt,
    });
  }
}

function toChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
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

function mapUsage(usage: unknown): AiUsage {
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
  return `DeepSeek request failed with ${response.status} ${response.statusText}`;
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
  const tokens =
    nonnegativeInt(input.promptTokens) + nonnegativeInt(input.completionTokens);
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
