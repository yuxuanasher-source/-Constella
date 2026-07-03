import { describe, expect, it } from "vitest";

import {
  createDoubaoAsrProvider,
  isDoubaoAsrConfigured,
  readDoubaoAsrConfigFromEnv,
  resolveDoubaoAsrTimeoutMs,
} from "./doubao-asr-provider";

function fakeResponse({
  ok = true,
  status = 200,
  statusCode = "20000000",
  statusMessage = "",
  body = {},
}: {
  ok?: boolean;
  status?: number;
  statusCode?: string;
  statusMessage?: string;
  body?: unknown;
}) {
  return {
    ok,
    status,
    headers: {
      get(name: string) {
        if (name === "X-Api-Status-Code") {
          return statusCode;
        }
        if (name === "X-Api-Message") {
          return statusMessage;
        }
        return null;
      },
    },
    json: () => Promise.resolve(body),
  };
}

describe("doubao ASR provider", () => {
  it("submits base64 audio to the flash endpoint and parses utterances", async () => {
    const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
    const provider = createDoubaoAsrProvider({
      appKey: "app-key",
      accessKey: "access-key",
      createRequestId: () => "req-1",
      fetchImpl: (url, init) => {
        calls.push({ url, init: init as unknown as Record<string, unknown> });
        return Promise.resolve(
          fakeResponse({
            body: {
              audio_info: { duration: 65_000 },
              result: {
                text: "大家好，今天聊新品。",
                utterances: [
                  { text: "大家好", start_time: 0, end_time: 1200 },
                  { text: "今天聊新品", start_time: 1300, end_time: 3800 },
                ],
              },
            },
          }),
        );
      },
    });

    const result = await provider.recognizeAudio({
      audioBase64: "bW9jaw==",
      format: "mp3",
    });

    expect(result.status).toBe("succeeded");
    expect(result.text).toBe("大家好，今天聊新品。");
    expect(result.durationSeconds).toBe(65);
    expect(result.utterances).toEqual([
      { text: "大家好", startSeconds: 0, endSeconds: 1.2 },
      { text: "今天聊新品", startSeconds: 1.3, endSeconds: 3.8 },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Api-App-Key"]).toBe("app-key");
    expect(headers["X-Api-Access-Key"]).toBe("access-key");
    expect(headers["X-Api-Resource-Id"]).toBe("volc.bigasr.auc_turbo");
    expect(headers["X-Api-Request-Id"]).toBe("req-1");
    expect(headers["X-Api-Sequence"]).toBe("-1");

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.audio).toEqual({ data: "bW9jaw==", format: "mp3" });
    expect(body.request.model_name).toBe("bigmodel");
    expect(body.request.show_utterances).toBe(true);
  });

  it("passes audio urls through without base64 data", async () => {
    let requestBody = "";
    const provider = createDoubaoAsrProvider({
      appKey: "app-key",
      accessKey: "access-key",
      fetchImpl: (_url, init) => {
        requestBody = String(init.body);
        return Promise.resolve(
          fakeResponse({ body: { result: { text: "ok" } } }),
        );
      },
    });

    const result = await provider.recognizeAudio({
      audioUrl: "https://example.com/audio.mp3",
      format: "mp3",
    });

    expect(result.status).toBe("succeeded");
    expect(JSON.parse(requestBody).audio).toEqual({
      url: "https://example.com/audio.mp3",
      format: "mp3",
    });
  });

  it("degrades without credentials so the caller can fall back", async () => {
    const provider = createDoubaoAsrProvider({
      fetchImpl: () => {
        throw new Error("should not be called");
      },
    });

    const result = await provider.recognizeAudio({
      audioBase64: "bW9jaw==",
      format: "mp3",
    });

    expect(result.status).toBe("degraded");
    expect(result.degradedReason).toBe("provider_unconfigured");
  });

  it("fails when the API returns a non-success status code header", async () => {
    const provider = createDoubaoAsrProvider({
      appKey: "app-key",
      accessKey: "access-key",
      fetchImpl: () =>
        Promise.resolve(
          fakeResponse({
            statusCode: "45000001",
            statusMessage: "invalid audio",
          }),
        ),
    });

    const result = await provider.recognizeAudio({
      audioBase64: "bW9jaw==",
      format: "mp3",
    });

    expect(result.status).toBe("failed");
    expect(result.errorSummary).toContain("45000001");
    expect(result.errorSummary).toContain("invalid audio");
  });

  it("fails when neither audio data nor url is provided", async () => {
    const provider = createDoubaoAsrProvider({
      appKey: "app-key",
      accessKey: "access-key",
      fetchImpl: () => {
        throw new Error("should not be called");
      },
    });

    const result = await provider.recognizeAudio({ format: "mp3" });

    expect(result.status).toBe("failed");
    expect(result.errorSummary).toContain("audioBase64 or audioUrl");
  });

  it("fails with a readable summary when the request rejects", async () => {
    const provider = createDoubaoAsrProvider({
      appKey: "app-key",
      accessKey: "access-key",
      fetchImpl: () => Promise.reject(new Error("network down")),
    });

    const result = await provider.recognizeAudio({
      audioBase64: "bW9jaw==",
      format: "mp3",
    });

    expect(result.status).toBe("failed");
    expect(result.errorSummary).toBe("network down");
  });
});

describe("doubao ASR config", () => {
  it("reads config with defaults from env", () => {
    const config = readDoubaoAsrConfigFromEnv({
      DOUBAO_ASR_APP_KEY: "app",
      DOUBAO_ASR_ACCESS_KEY: "key",
    });

    expect(config.appKey).toBe("app");
    expect(config.accessKey).toBe("key");
    expect(config.baseUrl).toBe("https://openspeech.bytedance.com");
    expect(config.resourceId).toBe("volc.bigasr.auc_turbo");
    expect(config.modelName).toBe("bigmodel");
    expect(config.timeoutMs).toBe(120_000);
    expect(isDoubaoAsrConfigured(config)).toBe(true);
  });

  it("treats missing credentials as unconfigured", () => {
    expect(isDoubaoAsrConfigured(readDoubaoAsrConfigFromEnv({}))).toBe(false);
  });

  it("honors the timeout override and rejects bad values", () => {
    expect(resolveDoubaoAsrTimeoutMs({ DOUBAO_ASR_TIMEOUT_MS: "5000" })).toBe(
      5000,
    );
    expect(resolveDoubaoAsrTimeoutMs({ DOUBAO_ASR_TIMEOUT_MS: "-1" })).toBe(
      120_000,
    );
    expect(resolveDoubaoAsrTimeoutMs({})).toBe(120_000);
  });
});
