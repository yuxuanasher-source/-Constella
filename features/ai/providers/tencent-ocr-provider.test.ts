import { describe, expect, it, vi } from "vitest";

import {
  createTencentOcrProvider,
  readTencentOcrConfigFromEnv,
} from "./tencent-ocr-provider";

describe("createTencentOcrProvider", () => {
  it("signs GeneralBasicOCR requests with TC3-HMAC-SHA256 headers", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Response: {
          TextDetections: [
            {
              DetectedText: "直播时长 80分钟",
              Confidence: 99,
              ItemPolygon: { X: 12, Y: 24, Width: 200, Height: 30 },
            },
            { DetectedText: "观看人数 320", Confidence: 98 },
          ],
          RequestId: "request-1",
        },
      }),
    }));
    const provider = createTencentOcrProvider({
      secretId: "AKIDEXAMPLE",
      secretKey: "SECRETEXAMPLE",
      region: "ap-guangzhou",
      fetchImpl,
      now: () => new Date("2026-06-04T04:00:00.000Z"),
    });

    const result = await provider.runGeneralBasicOcr({
      imageBase64: "ZmFrZS1pbWFnZQ==",
    });

    expect(result).toMatchObject({
      status: "succeeded",
      textLines: ["直播时长 80分钟", "观看人数 320"],
      textItems: [
        { text: "直播时长 80分钟", x: 12, y: 24, width: 200, height: 30 },
        { text: "观看人数 320", x: 0, y: 0, width: 0, height: 0 },
      ],
      confidence: 98,
      requestId: "request-1",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ocr.tencentcloudapi.com/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(
            /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\/2026-06-04\/ocr\/tc3_request, SignedHeaders=content-type;host, Signature=[a-f0-9]{64}$/,
          ),
          "Content-Type": "application/json; charset=utf-8",
          Host: "ocr.tencentcloudapi.com",
          "X-TC-Action": "GeneralBasicOCR",
          "X-TC-Region": "ap-guangzhou",
          "X-TC-Timestamp": "1780545600",
          "X-TC-Version": "2018-11-19",
        }),
        body: JSON.stringify({ ImageBase64: "ZmFrZS1pbWFnZQ==" }),
      }),
    );
  });

  it("weights confidence by detected text length instead of taking the minimum", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Response: {
          TextDetections: [
            // The numbers we actually parse, long and high-confidence.
            { DetectedText: "直播时长 120分钟 观看人数 5000", Confidence: 96 },
            // A short, noisy token that a plain min() would let drag the whole
            // extraction down to needs-confirmation.
            { DetectedText: "x", Confidence: 10 },
          ],
          RequestId: "request-weighted",
        },
      }),
    }));
    const provider = createTencentOcrProvider({
      secretId: "AKIDEXAMPLE",
      secretKey: "SECRETEXAMPLE",
      region: "ap-guangzhou",
      fetchImpl,
      now: () => new Date("2026-06-04T04:00:00.000Z"),
    });

    const result = await provider.runGeneralBasicOcr({
      imageBase64: "ZmFrZS1pbWFnZQ==",
    });

    // min() would be 10; the length-weighted average stays well above the
    // 70 human-confirmation threshold.
    expect(result.confidence).toBeGreaterThanOrEqual(90);
  });

  it("returns degraded when Tencent OCR credentials are not configured", async () => {
    const provider = createTencentOcrProvider({
      secretId: "",
      secretKey: "",
      region: "",
      fetchImpl: vi.fn(),
    });

    await expect(
      provider.runGeneralBasicOcr({ imageBase64: "ZmFrZS1pbWFnZQ==" }),
    ).resolves.toMatchObject({
      status: "degraded",
      degradedReason: "provider_unconfigured",
    });
  });

  it("reads Tencent OCR config from env", () => {
    expect(
      readTencentOcrConfigFromEnv({
        TENCENT_SECRET_ID: "id",
        TENCENT_SECRET_KEY: "key",
        TENCENT_OCR_REGION: "ap-guangzhou",
      }),
    ).toEqual({
      secretId: "id",
      secretKey: "key",
      region: "ap-guangzhou",
    });
  });
});

const realSmoke =
  process.env.TENCENT_SECRET_ID &&
  process.env.TENCENT_SECRET_KEY &&
  process.env.TENCENT_OCR_SMOKE_IMAGE_BASE64
    ? it
    : it.skip;

realSmoke("real Tencent OCR env-gated smoke", async () => {
  const provider = createTencentOcrProvider({
    ...readTencentOcrConfigFromEnv(process.env),
  });
  const imageBase64 = process.env.TENCENT_OCR_SMOKE_IMAGE_BASE64 ?? "";

  const result = await provider.runGeneralBasicOcr({
    imageBase64,
  });

  expect(["succeeded", "failed", "degraded"]).toContain(result.status);
  expect(JSON.stringify(result)).not.toContain(process.env.TENCENT_SECRET_KEY);
});
