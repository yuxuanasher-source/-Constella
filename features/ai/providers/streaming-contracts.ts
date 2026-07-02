import type { AiProvider, AiProviderResult, AiTextInput } from "../contracts";

// AI provider 的流式扩展契约。
// contracts.ts 里的 AiProvider 保持不变（其余调用方无感知）；
// 支持流式的 provider 在返回对象上额外实现 runTextStream，
// 网关侧用 supportsTextStreaming() 判别后走流式路径。
export type AiProviderStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: AiProviderResult }
  | { type: "error"; errorSummary: string };

export type AiStreamingProvider = AiProvider & {
  runTextStream(
    input: AiTextInput,
  ): AsyncGenerator<AiProviderStreamEvent, void, unknown>;
};

export function supportsTextStreaming(
  provider: AiProvider,
): provider is AiStreamingProvider {
  return (
    typeof (provider as Partial<AiStreamingProvider>).runTextStream ===
    "function"
  );
}

// 流式需要读取 response.body；测试里常用 new Response(...) 或裸对象 mock，
// 所以 body 保持可选，缺失时 provider 会以 error 事件收场（进入 fallback）。
export type StreamableFetchResponse = Pick<
  Response,
  "json" | "ok" | "status" | "statusText"
> & {
  body?: ReadableStream<Uint8Array> | null;
};

export type StreamableFetch = (
  input: string,
  init?: RequestInit,
) => Promise<StreamableFetchResponse>;
