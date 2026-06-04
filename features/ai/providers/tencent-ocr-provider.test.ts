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
            { DetectedText: "直播时长 80分钟", Confidence: 99 },
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
      confidence: 98,
      requestId: "request-1",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ocr.tencentcloudapi.com/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("TC3-HMAC-SHA256"),
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

const realSmoke = process.env.TENCENT_SECRET_ID &&
  process.env.TENCENT_SECRET_KEY &&
  process.env.TENCENT_OCR_SMOKE_IMAGE_BASE64
  ? it
  : it.skip;

realSmoke("real Tencent OCR env-gated smoke", async () => {
  const provider = createTencentOcrProvider({
    ...readTencentOcrConfigFromEnv(process.env),
  });

  const result = await provider.runGeneralBasicOcr({
    imageBase64: process.env.TENCENT_OCR_SMOKE_IMAGE_BASE64,
  });

  expect(["succeeded", "failed", "degraded"]).toContain(result.status);
  expect(JSON.stringify(result)).not.toContain(process.env.TENCENT_SECRET_KEY);
});
