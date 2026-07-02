import { randomUUID } from "node:crypto";

import {
  createProviderTimeout,
  timeoutErrorSummary,
} from "./provider-timeout";

// 豆包（火山引擎）大模型录音文件识别·极速版。
// 同步接口：一次 POST 直接返回带毫秒时间戳的转写结果，支持 base64 直传音频，
// 因此本地开发（存储无公网 URL）也可用。用于录屏 AI 分析的「语音转文字」环节。
// 文档：火山引擎「大模型录音文件极速版识别 API」（volc.bigasr.auc_turbo）。
const DEFAULT_DOUBAO_ASR_BASE_URL = "https://openspeech.bytedance.com";
const DEFAULT_DOUBAO_ASR_RESOURCE_ID = "volc.bigasr.auc_turbo";
const DEFAULT_DOUBAO_ASR_MODEL = "bigmodel";
// 长录音转写比一次 chat 调用慢得多，默认给 120s，可用 DOUBAO_ASR_TIMEOUT_MS 覆盖。
const DEFAULT_DOUBAO_ASR_TIMEOUT_MS = 120_000;
const FLASH_RECOGNIZE_PATH = "/api/v3/auc/bigmodel/recognize/flash";
const SUCCESS_STATUS_CODE = "20000000";
const PROVIDER_LABEL = "Doubao ASR";

export type DoubaoAsrConfig = {
  appKey?: string;
  accessKey?: string;
  baseUrl?: string;
  resourceId?: string;
  modelName?: string;
  uid?: string;
  timeoutMs?: number;
};

export type DoubaoAsrInput = {
  audioBase64?: string;
  audioUrl?: string;
  format: string;
};

export type DoubaoAsrUtterance = {
  text: string;
  startSeconds: number;
  endSeconds: number;
};

export type DoubaoAsrResult = {
  status: "succeeded" | "failed" | "degraded";
  text: string;
  utterances: DoubaoAsrUtterance[];
  durationSeconds: number | null;
  requestId?: string;
  latencyMs: number;
  degradedReason?: string;
  errorSummary?: string;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

type FetchImpl = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

export type DoubaoAsrProvider = {
  recognizeAudio(input: DoubaoAsrInput): Promise<DoubaoAsrResult>;
};

export function resolveDoubaoAsrTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.DOUBAO_ASR_TIMEOUT_MS;
  const parsed = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : DEFAULT_DOUBAO_ASR_TIMEOUT_MS;
}

export function readDoubaoAsrConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): DoubaoAsrConfig {
  return {
    appKey: env.DOUBAO_ASR_APP_KEY ?? "",
    accessKey: env.DOUBAO_ASR_ACCESS_KEY ?? "",
    baseUrl: env.DOUBAO_ASR_BASE_URL || DEFAULT_DOUBAO_ASR_BASE_URL,
    resourceId: env.DOUBAO_ASR_RESOURCE_ID || DEFAULT_DOUBAO_ASR_RESOURCE_ID,
    modelName: env.DOUBAO_ASR_MODEL || DEFAULT_DOUBAO_ASR_MODEL,
    timeoutMs: resolveDoubaoAsrTimeoutMs(env),
  };
}

export function isDoubaoAsrConfigured(config: DoubaoAsrConfig): boolean {
  return Boolean(config.appKey?.trim() && config.accessKey?.trim());
}

export function createDoubaoAsrProvider({
  appKey = "",
  accessKey = "",
  baseUrl = DEFAULT_DOUBAO_ASR_BASE_URL,
  resourceId = DEFAULT_DOUBAO_ASR_RESOURCE_ID,
  modelName = DEFAULT_DOUBAO_ASR_MODEL,
  uid = "constella-recording-ai",
  timeoutMs = DEFAULT_DOUBAO_ASR_TIMEOUT_MS,
  fetchImpl = globalThis.fetch as unknown as FetchImpl,
  createRequestId = randomUUID,
}: DoubaoAsrConfig & {
  fetchImpl?: FetchImpl;
  createRequestId?: () => string;
} = {}): DoubaoAsrProvider {
  return {
    async recognizeAudio(input: DoubaoAsrInput): Promise<DoubaoAsrResult> {
      if (!appKey.trim() || !accessKey.trim()) {
        return {
          status: "degraded",
          text: "",
          utterances: [],
          durationSeconds: null,
          latencyMs: 0,
          degradedReason: "provider_unconfigured",
          errorSummary: "Doubao ASR credentials are not configured",
        };
      }

      if (!input.audioBase64?.trim() && !input.audioUrl?.trim()) {
        return {
          status: "failed",
          text: "",
          utterances: [],
          durationSeconds: null,
          latencyMs: 0,
          errorSummary: "Doubao ASR requires audioBase64 or audioUrl",
        };
      }

      const requestId = createRequestId();
      const startedAt = Date.now();
      // 超时中止后 fetch 会拒绝，走 catch 返回 failed（调用方按失败处理并回退）。
      const timeout = createProviderTimeout(timeoutMs, PROVIDER_LABEL);

      try {
        const response = await fetchImpl(
          `${baseUrl.replace(/\/+$/, "")}${FLASH_RECOGNIZE_PATH}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-App-Key": appKey,
              "X-Api-Access-Key": accessKey,
              "X-Api-Resource-Id": resourceId,
              "X-Api-Request-Id": requestId,
              "X-Api-Sequence": "-1",
            },
            body: JSON.stringify({
              user: { uid },
              audio: {
                ...(input.audioBase64?.trim()
                  ? { data: input.audioBase64 }
                  : { url: input.audioUrl }),
                format: input.format,
              },
              request: {
                model_name: modelName,
                enable_itn: true,
                enable_punc: true,
                show_utterances: true,
              },
            }),
            signal: timeout.signal,
          },
        );

        const latencyMs = Date.now() - startedAt;
        const statusCode = response.headers.get("X-Api-Status-Code") ?? "";
        const statusMessage = response.headers.get("X-Api-Message") ?? "";
        const raw = await response.json().catch(() => ({}));

        if (!response.ok || statusCode !== SUCCESS_STATUS_CODE) {
          return {
            status: "failed",
            text: "",
            utterances: [],
            durationSeconds: null,
            requestId,
            latencyMs,
            errorSummary:
              `Doubao ASR failed with status ${statusCode || response.status}` +
              (statusMessage ? `: ${statusMessage}` : ""),
          };
        }

        const parsed = parseFlashResult(raw);
        return {
          status: "succeeded",
          text: parsed.text,
          utterances: parsed.utterances,
          durationSeconds: parsed.durationSeconds,
          requestId,
          latencyMs,
        };
      } catch (error) {
        return {
          status: "failed",
          text: "",
          utterances: [],
          durationSeconds: null,
          requestId,
          latencyMs: Date.now() - startedAt,
          errorSummary: timeoutErrorSummary({
            timeout,
            timeoutMs,
            label: PROVIDER_LABEL,
            error,
            fallbackMessage: "Doubao ASR request failed",
          }),
        };
      } finally {
        timeout.clear();
      }
    },
  };
}

function parseFlashResult(raw: unknown): {
  text: string;
  utterances: DoubaoAsrUtterance[];
  durationSeconds: number | null;
} {
  const body = objectValue(raw);
  const result = objectValue(body.result);
  const audioInfo = objectValue(body.audio_info);
  const durationMs = numberValue(audioInfo.duration);

  const utterances = (Array.isArray(result.utterances) ? result.utterances : [])
    .map((item): DoubaoAsrUtterance | null => {
      const utterance = objectValue(item);
      const text = stringValue(utterance.text);
      if (!text) {
        return null;
      }
      return {
        text,
        startSeconds: msToSeconds(numberValue(utterance.start_time)),
        endSeconds: msToSeconds(numberValue(utterance.end_time)),
      };
    })
    .filter((item): item is DoubaoAsrUtterance => item !== null);

  return {
    text: stringValue(result.text) ?? "",
    utterances,
    durationSeconds: durationMs === null ? null : msToSeconds(durationMs),
  };
}

function msToSeconds(value: number | null): number {
  if (value === null || value <= 0) {
    return 0;
  }
  return Math.round(value / 100) / 10;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
