import type {
  AiGatewayResult,
  AiProvider,
  AiProviderName,
  AiTextInput,
  AiUsage,
} from "./contracts";
import { orderProviders } from "./llm-gateway";
import { supportsTextStreaming } from "./providers/streaming-contracts";

// 流式网关：与 runAiGateway 的 fallback 语义对齐，但按“流是否已开始”决定能否切换 provider：
// - 流开始前失败（HTTP 错误、超时、空响应）→ 顺序切换到下一个 provider；
// - 流已开始后失败 → 不再切换（下游可能已渲染部分 delta），发 error 事件并终止。
// 注意：AI_SHADOW_PROVIDER 的影子对标只在非流式路径进行（shadow 需要完整响应做对比、
// 且会产生双份调用成本），流式请求显式跳过 shadow，避免拖慢首包。
export type AiGatewayStreamEvent =
  | {
      type: "delta";
      text: string;
      providerName: AiProviderName;
      fallbackUsed: boolean;
    }
  | { type: "done"; result: AiGatewayResult }
  | { type: "error"; result: AiGatewayResult; streamStarted: boolean };

export async function* runAiGatewayStream({
  providers,
  primaryProvider,
  request,
}: {
  providers: AiProvider[];
  primaryProvider?: AiProviderName;
  request: AiTextInput;
}): AsyncGenerator<AiGatewayStreamEvent, void, unknown> {
  const candidates = orderProviders(
    providers.filter((provider) => provider.capabilities.includes("text")),
    primaryProvider,
  );

  if (!candidates.length) {
    yield {
      type: "error",
      streamStarted: false,
      result: {
        status: "degraded",
        fallbackUsed: false,
        degradedReason: "provider_unconfigured",
        errorSummary: "No text-capable AI provider is configured",
        usage: emptyUsage(),
        latencyMs: 0,
        costCents: 0,
      },
    };
    return;
  }

  const failures: string[] = [];

  for (const [index, provider] of candidates.entries()) {
    const fallbackUsed = index > 0;
    const startedAt = Date.now();
    let streamStarted = false;
    let aggregatedText = "";

    try {
      if (!supportsTextStreaming(provider)) {
        // 不支持流式的 provider（如 deterministic 兜底）：非流式跑完后
        // 适配成“一次完整 delta + done”，保持下游消费逻辑一致。
        const result = await provider.runText(request);
        if (result.status !== "succeeded" || !result.text?.trim()) {
          failures.push(result.errorSummary ?? `${provider.name} failed`);
          continue;
        }
        yield {
          type: "delta",
          text: result.text,
          providerName: provider.name,
          fallbackUsed,
        };
        yield {
          type: "done",
          result: {
            ...result,
            providerName: provider.name,
            fallbackUsed,
            degradedReason: fallbackUsed
              ? "primary_failed"
              : result.degradedReason,
          },
        };
        return;
      }

      let providerFailure: string | null = null;
      let doneResult: AiGatewayResult | null = null;

      for await (const event of provider.runTextStream(request)) {
        if (event.type === "delta") {
          if (!event.text) {
            continue;
          }
          streamStarted = true;
          aggregatedText += event.text;
          yield {
            type: "delta",
            text: event.text,
            providerName: provider.name,
            fallbackUsed,
          };
          continue;
        }

        if (event.type === "done") {
          const text = event.result.text || aggregatedText;
          if (event.result.status !== "succeeded" || !text.trim()) {
            providerFailure =
              event.result.errorSummary ??
              `${provider.name} returned an empty stream`;
          } else {
            doneResult = {
              ...event.result,
              text,
              providerName: provider.name,
              fallbackUsed,
              degradedReason: fallbackUsed
                ? "primary_failed"
                : event.result.degradedReason,
            };
          }
          break;
        }

        providerFailure = event.errorSummary;
        break;
      }

      if (doneResult) {
        yield { type: "done", result: doneResult };
        return;
      }

      const summary =
        providerFailure ?? `${provider.name} stream ended unexpectedly`;
      if (streamStarted) {
        yield interruptedEvent({
          provider,
          fallbackUsed,
          errorSummary: summary,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }
      failures.push(summary);
    } catch (error) {
      const summary =
        error instanceof Error ? error.message : "provider failed";
      if (streamStarted) {
        yield interruptedEvent({
          provider,
          fallbackUsed,
          errorSummary: summary,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }
      failures.push(summary);
    }
  }

  yield {
    type: "error",
    streamStarted: false,
    result: {
      status: "failed",
      providerName: candidates[0]?.name,
      fallbackUsed: candidates.length > 1,
      degradedReason: "all_providers_failed",
      errorSummary: failures.join("; "),
      usage: emptyUsage(),
      latencyMs: 0,
      costCents: 0,
    },
  };
}

function interruptedEvent({
  provider,
  fallbackUsed,
  errorSummary,
  latencyMs,
}: {
  provider: AiProvider;
  fallbackUsed: boolean;
  errorSummary: string;
  latencyMs: number;
}): AiGatewayStreamEvent {
  return {
    type: "error",
    streamStarted: true,
    result: {
      status: "failed",
      providerName: provider.name,
      fallbackUsed,
      degradedReason: "stream_interrupted",
      errorSummary,
      usage: emptyUsage(),
      latencyMs,
      costCents: 0,
    },
  };
}

function emptyUsage(): AiUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}
