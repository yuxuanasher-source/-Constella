import { createHash, createHmac } from "node:crypto";

import {
  createProviderTimeout,
  resolveAiProviderTimeoutMs,
  timeoutErrorSummary,
} from "./provider-timeout";

export type TencentOcrConfig = {
  secretId?: string;
  secretKey?: string;
  region?: string;
};

export type TencentOcrInput =
  | { imageBase64: string; imageUrl?: never }
  | { imageUrl: string; imageBase64?: never };

export type OcrTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TencentOcrResult = {
  status: "succeeded" | "failed" | "degraded";
  textLines: string[];
  textItems: OcrTextItem[];
  confidence: number;
  requestId?: string;
  rawResponse?: unknown;
  degradedReason?: string;
  errorSummary?: string;
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
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

export type TencentOcrProvider = {
  runGeneralBasicOcr(input: TencentOcrInput): Promise<TencentOcrResult>;
};

const endpoint = "https://ocr.tencentcloudapi.com/";
const host = "ocr.tencentcloudapi.com";
const service = "ocr";
const version = "2018-11-19";
const action = "GeneralBasicOCR";

export function readTencentOcrConfigFromEnv(
  env: Record<string, string | undefined>,
): Required<TencentOcrConfig> {
  return {
    secretId: env.TENCENT_SECRET_ID ?? "",
    secretKey: env.TENCENT_SECRET_KEY ?? "",
    region: env.TENCENT_OCR_REGION ?? "",
  };
}

export function createTencentOcrProvider({
  secretId = "",
  secretKey = "",
  region = "",
  fetchImpl = globalThis.fetch as unknown as FetchImpl,
  now = () => new Date(),
  timeoutMs = resolveAiProviderTimeoutMs(),
}: TencentOcrConfig & {
  fetchImpl?: FetchImpl;
  now?: () => Date;
  timeoutMs?: number;
}): TencentOcrProvider {
  return {
    async runGeneralBasicOcr(
      input: TencentOcrInput,
    ): Promise<TencentOcrResult> {
      if (!secretId || !secretKey || !region) {
        return {
          status: "degraded",
          textLines: [],
          textItems: [],
          confidence: 0,
          degradedReason: "provider_unconfigured",
          errorSummary: "Tencent OCR credentials are not configured",
        };
      }

      const payload = JSON.stringify(toTencentPayload(input));
      const timestamp = Math.floor(now().getTime() / 1000);
      const headers = signTencentRequest({
        secretId,
        secretKey,
        region,
        timestamp,
        payload,
      });

      // 超时中止后 fetch 会拒绝，走 catch 返回 failed（调用方按失败处理）。
      const timeout = createProviderTimeout(timeoutMs, "Tencent OCR");

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: payload,
          signal: timeout.signal,
        });
        const rawResponse = await response.json();
        const parsed = parseTencentResponse(rawResponse);

        if (!response.ok) {
          return {
            status: "failed",
            textLines: [],
            textItems: [],
            confidence: 0,
            rawResponse,
            errorSummary:
              parsed.errorSummary ?? `Tencent OCR HTTP ${response.status}`,
          };
        }

        if (parsed.errorSummary) {
          return {
            status: "failed",
            textLines: [],
            textItems: [],
            confidence: 0,
            requestId: parsed.requestId,
            rawResponse,
            errorSummary: parsed.errorSummary,
          };
        }

        return {
          status: "succeeded",
          textLines: parsed.textLines,
          textItems: parsed.textItems,
          confidence: parsed.confidence,
          requestId: parsed.requestId,
          rawResponse,
        };
      } catch (error) {
        return {
          status: "failed",
          textLines: [],
          textItems: [],
          confidence: 0,
          errorSummary: timeoutErrorSummary({
            timeout,
            timeoutMs,
            label: "Tencent OCR",
            error,
            fallbackMessage: "Tencent OCR request failed",
          }),
        };
      } finally {
        timeout.clear();
      }
    },
  };
}

function toTencentPayload(input: TencentOcrInput): Record<string, string> {
  if ("imageBase64" in input) {
    return { ImageBase64: input.imageBase64 ?? "" };
  }
  return { ImageUrl: input.imageUrl ?? "" };
}

function signTencentRequest({
  secretId,
  secretKey,
  region,
  timestamp,
  payload,
}: {
  secretId: string;
  secretKey: string;
  region: string;
  timestamp: number;
  payload: string;
}): Record<string, string> {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders =
    "content-type:application/json; charset=utf-8\n" + `host:${host}\n`;
  const signedHeaders = "content-type;host";
  const hashedRequestPayload = sha256Hex(payload);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmacHex(secretSigning, stringToSign);
  const authorization =
    "TC3-HMAC-SHA256 " +
    [
      `Credential=${secretId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");

  return {
    Authorization: authorization,
    "Content-Type": "application/json; charset=utf-8",
    Host: host,
    "X-TC-Action": action,
    "X-TC-Region": region,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": version,
  };
}

function parseTencentResponse(rawResponse: unknown): {
  textLines: string[];
  textItems: OcrTextItem[];
  confidence: number;
  requestId?: string;
  errorSummary?: string;
} {
  const response = objectValue(rawResponse).Response;
  const responseObject = objectValue(response);
  const error = objectValue(responseObject.Error);
  const errorMessage = stringValue(error.Message);
  if (errorMessage) {
    return {
      textLines: [],
      textItems: [],
      confidence: 0,
      requestId: stringValue(responseObject.RequestId),
      errorSummary: errorMessage,
    };
  }

  const detections = Array.isArray(responseObject.TextDetections)
    ? responseObject.TextDetections
    : [];
  const textItems = detections
    .map((item): OcrTextItem | null => {
      const detection = objectValue(item);
      const text = stringValue(detection.DetectedText);
      if (!text) {
        return null;
      }
      const polygon = objectValue(detection.ItemPolygon);
      return {
        text,
        x: numberValue(polygon.X) ?? 0,
        y: numberValue(polygon.Y) ?? 0,
        width: numberValue(polygon.Width) ?? 0,
        height: numberValue(polygon.Height) ?? 0,
      };
    })
    .filter((item): item is OcrTextItem => item !== null);
  const textLines = textItems.map((item) => item.text);
  // Character-length-weighted average confidence. A single short, noisy token
  // (e.g. a stray icon) no longer drags the whole extraction below the
  // human-confirmation threshold the way a plain min() did; longer detected
  // strings (which carry the duration / 场观 numbers we parse) weigh more.
  const weightedConfidences = detections
    .map((item) => {
      const detection = objectValue(item);
      const confidence = numberValue(detection.Confidence);
      if (confidence === null) {
        return null;
      }
      const text = stringValue(detection.DetectedText) ?? "";
      return { confidence, weight: Math.max(1, text.trim().length) };
    })
    .filter(
      (entry): entry is { confidence: number; weight: number } =>
        entry !== null,
    );
  const totalWeight = weightedConfidences.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );
  const confidence = totalWeight
    ? weightedConfidences.reduce(
        (sum, entry) => sum + entry.confidence * entry.weight,
        0,
      ) / totalWeight
    : 0;

  return {
    textLines,
    textItems,
    confidence: Math.trunc(confidence),
    requestId: stringValue(responseObject.RequestId),
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: string | Buffer, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
