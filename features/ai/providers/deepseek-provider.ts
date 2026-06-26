import type {
  AiCostEstimate,
  AiMessage,
  AiProvider,
  AiProviderResult,
  AiStructuredInput,
  AiTextInput,
  AiToolRunInput,
  AiUsageEstimateInput,
} from "../contracts";

/**
 * DeepSeek 适配器。
 *
 * DeepSeek 的 `/chat/completions` 与 OpenAI 协议兼容，因此这里只做最薄的一层
 * 映射：把网关的 `AiMessage` / `AiTool` 翻译成 OpenAI 风格的请求体，再把响应
 * 还原成 `AiProviderResult`。鉴权使用 `Authorization: Bearer <DEEPSEEK_API_KEY>`。
 *
 * 文档：见 `docs/integrations/deepseek-api.md`。
 */

export type DeepSeekModel =
  | "deepseek-chat"
  | "deepseek-reasoner"
  | (string & {});

export type DeepSeekPricing = {
  /** 缓存未命中输入 token 单价（分 / 每百万 token） */
  inputCacheMissCentsPerMillion: number;
  /** 缓存命中输入 token 单价（分 / 每百万 token） */
  inputCacheHitCentsPerMillion: number;
  /** 输出 token 单价（分 / 每百万 token） */
  outputCentsPerMillion: number;
};

export type DeepSeekConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: DeepSeekModel;
  /** 采样温度。deepseek-reasoner 会忽略该参数。 */
  temperature?: number;
  maxTokens?: number;
  pricing?: DeepSeekPricing;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchImpl = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<FetchResponse>;

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL: DeepSeekModel = "deepseek-chat";

/**
 * 参考价格（截至 2025 年，单位：分 / 百万 token，按汇率折算后建议在部署时校准）。
 * 真实计费以 DeepSeek 控制台为准，可通过 `pricing` 覆盖。
 */
const DEFAULT_PRICING: DeepSeekPricing = {
  inputCacheMissCentsPerMillion: 27,
  inputCacheHitCentsPerMillion: 7,
  outputCentsPerMillion: 110,
};

export function readDeepSeekConfigFromEnv(
  env: Record<string, string | undefined>,
): Required<Omit<DeepSeekConfig, "temperature" | "maxTokens" | "pricing">> {
  return {
    apiKey: env.DEEPSEEK_API_KEY ?? "",
    baseUrl: env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
    model: (env.DEEPSEEK_MODEL as DeepSeekModel) ?? DEFAULT_MODEL,
  };
}

export function createDeepSeekProvider({
  apiKey = "",
  baseUrl = DEFAULT_BASE_URL,
  model = DEFAULT_MODEL,
  temperature,
  maxTokens,
  pricing = DEFAULT_PRICING,
  fetchImpl = globalThis.fetch as unknown as FetchImpl,
  now = () => new Date(),
}: DeepSeekConfig & {
  fetchImpl?: FetchImpl;
  now?: () => Date;
} = {}): AiProvider {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  function estimateCost(input: AiUsageEstimateInput): AiCostEstimate {
    return {
      costCents: costCentsFor(
        pricing,
        input.promptTokens ?? 0,
        0,
        input.completionTokens ?? 0,
      ),
    };
  }

  async function call(
    messages: AiMessage[],
    extra: Record<string, unknown>,
  ): Promise<AiProviderResult> {
    if (!apiKey) {
      return {
        status: "degraded",
        degradedReason: "provider_unconfigured",
        errorSummary: "DeepSeek API key is not configured",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 0,
        costCents: 0,
      };
    }

    const startedAt = now().getTime();
    const body = JSON.stringify({
      model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      stream: false,
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
      ...extra,
    });

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      });

      const rawResponse = await response.json();
      const latencyMs = Math.max(0, now().getTime() - startedAt);

      if (!response.ok) {
        return {
          status: "failed",
          rawResponse,
          errorSummary: errorSummaryFor(rawResponse, response.status),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latencyMs,
          costCents: 0,
        };
      }

      const parsed = parseChatCompletion(rawResponse);
      return {
        status: "succeeded",
        text: parsed.content,
        toolCalls: parsed.toolCalls,
        rawResponse,
        usage: parsed.usage,
        latencyMs,
        costCents: costCentsFor(
          pricing,
          parsed.cacheMissTokens,
          parsed.cacheHitTokens,
          parsed.usage.completionTokens,
        ),
      };
    } catch (error) {
      return {
        status: "failed",
        errorSummary:
          error instanceof Error ? error.message : "DeepSeek request failed",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: Math.max(0, now().getTime() - startedAt),
        costCents: 0,
      };
    }
  }

  return {
    name: "deepseek",
    capabilities: ["text", "structured", "tools", "shadow"],
    async runText(input: AiTextInput): Promise<AiProviderResult> {
      return call(input.messages, {});
    },
    async runStructured(input: AiStructuredInput): Promise<AiProviderResult> {
      const result = await call(input.messages, {
        response_format: { type: "json_object" },
      });
      if (result.status !== "succeeded") {
        return result;
      }
      const structuredOutput = safeJsonParse(result.text);
      if (structuredOutput === undefined) {
        return {
          ...result,
          status: "failed",
          degradedReason: "structured_output_unparsable",
          errorSummary: "DeepSeek did not return valid JSON",
        };
      }
      return { ...result, structuredOutput };
    },
    async runWithTools(input: AiToolRunInput): Promise<AiProviderResult> {
      return call(input.messages, {
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema ?? { type: "object" },
          },
        })),
        tool_choice: "auto",
      });
    },
    estimateCost,
  };
}

function parseChatCompletion(rawResponse: unknown): {
  content?: string;
  toolCalls?: unknown[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cacheHitTokens: number;
  cacheMissTokens: number;
} {
  const root = objectValue(rawResponse);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const message = objectValue(objectValue(choices[0]).message);
  const content = stringValue(message.content);
  const toolCalls = Array.isArray(message.tool_calls)
    ? (message.tool_calls as unknown[])
    : undefined;

  const usage = objectValue(root.usage);
  const promptTokens = numberValue(usage.prompt_tokens) ?? 0;
  const completionTokens = numberValue(usage.completion_tokens) ?? 0;
  const totalTokens =
    numberValue(usage.total_tokens) ?? promptTokens + completionTokens;
  const cacheHitTokens = numberValue(usage.prompt_cache_hit_tokens) ?? 0;
  const cacheMissTokens =
    numberValue(usage.prompt_cache_miss_tokens) ??
    Math.max(0, promptTokens - cacheHitTokens);

  return {
    content,
    toolCalls,
    usage: { promptTokens, completionTokens, totalTokens },
    cacheHitTokens,
    cacheMissTokens,
  };
}

function errorSummaryFor(rawResponse: unknown, status: number): string {
  const error = objectValue(objectValue(rawResponse).error);
  return stringValue(error.message) ?? `DeepSeek HTTP ${status}`;
}

function costCentsFor(
  pricing: DeepSeekPricing,
  cacheMissTokens: number,
  cacheHitTokens: number,
  completionTokens: number,
): number {
  const perMillion = (tokens: number, rate: number) =>
    (Math.max(0, tokens) / 1_000_000) * rate;
  return (
    perMillion(cacheMissTokens, pricing.inputCacheMissCentsPerMillion) +
    perMillion(cacheHitTokens, pricing.inputCacheHitCentsPerMillion) +
    perMillion(completionTokens, pricing.outputCentsPerMillion)
  );
}

function safeJsonParse(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
