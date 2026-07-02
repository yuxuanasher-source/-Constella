// AI provider fetch 超时控制。
// - 非流式请求：整个 fetch + 响应解析共用一个超时窗口。
// - 流式请求：按“空闲超时”处理，每收到一个 chunk 调用 refresh() 重置计时，
//   避免长回复被整体超时误杀，同时仍能兜住挂死的连接。
// 默认 30s，可用环境变量 AI_PROVIDER_TIMEOUT_MS 覆盖（见 .env.example）。

const DEFAULT_AI_PROVIDER_TIMEOUT_MS = 30_000;

export function resolveAiProviderTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.AI_PROVIDER_TIMEOUT_MS;
  const parsed = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : DEFAULT_AI_PROVIDER_TIMEOUT_MS;
}

export type ProviderTimeout = {
  /** 传给 fetch 的 AbortSignal；超时后 reason 是一条可读的 Error。 */
  signal: AbortSignal;
  /** 流式场景：收到数据时重置空闲计时。 */
  refresh(): void;
  /** 请求完成后清理计时器（放在 finally 里调用）。 */
  clear(): void;
  /** 是否因超时而中止（用于生成明确的 errorSummary）。 */
  timedOut(): boolean;
};

// 用手写 AbortController 而不是 AbortSignal.timeout：
// 1) 流式需要可重置的空闲超时；2) 请求完成后可以 clear 掉计时器；
// 3) 在 fake-timer 测试环境下行为可控。
export function createProviderTimeout(
  timeoutMs: number,
  label: string,
): ProviderTimeout {
  const controller = new AbortController();
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onTimeout = () => {
    fired = true;
    timer = null;
    controller.abort(
      new Error(`${label} request timed out after ${timeoutMs}ms`),
    );
  };

  timer = setTimeout(onTimeout, timeoutMs);

  return {
    signal: controller.signal,
    refresh() {
      if (fired) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(onTimeout, timeoutMs);
    },
    clear() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    timedOut() {
      return fired;
    },
  };
}

export function timeoutErrorSummary({
  timeout,
  timeoutMs,
  label,
  error,
  fallbackMessage,
}: {
  timeout: ProviderTimeout;
  timeoutMs: number;
  label: string;
  error: unknown;
  fallbackMessage: string;
}): string {
  if (timeout.timedOut()) {
    return `${label} request timed out after ${timeoutMs}ms`;
  }
  return error instanceof Error ? error.message : fallbackMessage;
}
