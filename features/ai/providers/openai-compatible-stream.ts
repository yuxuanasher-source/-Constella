import type { AiUsage } from "../contracts";
import { createProviderTimeout, timeoutErrorSummary } from "./provider-timeout";
import { iterateSseData } from "./sse-stream";
import type { AiProviderStreamEvent, StreamableFetch } from "./streaming-contracts";

// OpenAI 兼容 chat/completions 的流式实现（DeepSeek / 混元同形态）：
// 请求带 stream:true，逐 chunk 解析 `data: {...}` 中的 choices[].delta.content；
// stream_options.include_usage 让最后一个 chunk 携带 usage 统计。
// 事件契约（对齐 streaming-contracts.ts）：
// - HTTP 层失败 / 超时 / 无 body → error 事件（流未开始，网关可 fallback）；
// - 正常收尾（[DONE] 或流关闭）→ done 事件（带聚合 text + usage）。
export async function* streamOpenAiCompatibleChat({
  url,
  apiKey,
  requestBody,
  fetchImpl,
  timeoutMs,
  providerLabel,
}: {
  url: string;
  apiKey: string;
  requestBody: Record<string, unknown>;
  fetchImpl: StreamableFetch;
  timeoutMs: number;
  providerLabel: string;
}): AsyncGenerator<AiProviderStreamEvent, void, unknown> {
  const startedAt = Date.now();
  const timeout = createProviderTimeout(timeoutMs, providerLabel);
  let text = "";
  let usage: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        ...requestBody,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const raw = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      yield {
        type: "error",
        errorSummary:
          extractErrorMessage(raw) ??
          `${providerLabel} request failed with ${response.status} ${response.statusText}`,
      };
      return;
    }

    if (!response.body) {
      yield {
        type: "error",
        errorSummary: `${providerLabel} streaming response has no body`,
      };
      return;
    }

    for await (const data of iterateSseData({
      body: response.body,
      onActivity: () => timeout.refresh(),
    })) {
      if (data === "[DONE]") {
        break;
      }
      const chunk = parseJsonRecord(data);
      if (!chunk) {
        continue;
      }

      const errorMessage = extractErrorMessage(chunk);
      if (errorMessage) {
        yield { type: "error", errorSummary: errorMessage };
        return;
      }

      const chunkUsage = mapChunkUsage(chunk.usage);
      if (chunkUsage) {
        usage = chunkUsage;
      }

      const delta = extractDeltaText(chunk);
      if (delta) {
        text += delta;
        yield { type: "delta", text: delta };
      }
    }

    yield {
      type: "done",
      result: {
        status: "succeeded",
        text,
        toolCalls: [],
        usage,
        latencyMs: Date.now() - startedAt,
        costCents: estimateStreamCostCents(usage),
      },
    };
  } catch (error) {
    yield {
      type: "error",
      errorSummary: timeoutErrorSummary({
        timeout,
        timeoutMs,
        label: providerLabel,
        error,
        fallbackMessage: `${providerLabel} stream failed`,
      }),
    };
  } finally {
    timeout.clear();
  }
}

function extractDeltaText(chunk: Record<string, unknown>): string {
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  const firstChoice = choices.find(isRecord);
  const delta = isRecord(firstChoice?.delta) ? firstChoice.delta : undefined;
  return typeof delta?.content === "string" ? delta.content : "";
}

function mapChunkUsage(usage: unknown): AiUsage | null {
  if (!isRecord(usage)) {
    return null;
  }
  const promptTokens = nonnegativeInt(usage.prompt_tokens);
  const completionTokens = nonnegativeInt(usage.completion_tokens);
  const totalTokens =
    nonnegativeInt(usage.total_tokens) || promptTokens + completionTokens;
  if (!promptTokens && !completionTokens && !totalTokens) {
    return null;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function extractErrorMessage(raw: Record<string, unknown>): string | null {
  if (isRecord(raw.error) && typeof raw.error.message === "string") {
    return raw.error.message;
  }
  return null;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// 与各 provider 非流式路径一致的粗粒度成本估算（tokens/1000 上取整）。
function estimateStreamCostCents(usage: AiUsage): number {
  const tokens = usage.promptTokens + usage.completionTokens;
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
