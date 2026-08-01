import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const cosMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  getObject: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("cos-nodejs-sdk-v5", () => ({
  default: class MockCos {
    constructor(options: unknown) {
      cosMocks.construct(options);
    }

    getObject(params: unknown) {
      return cosMocks.getObject(params);
    }

    putObject(params: unknown) {
      return cosMocks.putObject(params);
    }

    deleteObject(params: unknown) {
      return cosMocks.deleteObject(params);
    }
  },
}));

vi.mock("@/lib/config/env", () => ({
  getTencentCosConfig: cosMocks.getConfig,
}));

const config = {
  secretId: "secret-id",
  secretKey: "secret-key",
  bucket: "private-bucket-123",
  region: "ap-guangzhou",
};

async function loadStorage() {
  return import("./tencent-cos");
}

describe("Tencent COS JSON storage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cosMocks.getConfig.mockReturnValue(config);
  });

  it("constructs one client with credentials and writes JSON with the configured location", async () => {
    cosMocks.putObject.mockResolvedValue({ ETag: "etag" });
    const { cosPutJson } = await loadStorage();

    await cosPutJson("knowledge/item.json", { answer: 42 });
    await cosPutJson("knowledge/second.json", { ok: true });

    expect(cosMocks.construct).toHaveBeenCalledTimes(1);
    expect(cosMocks.construct).toHaveBeenCalledWith({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
    });
    expect(cosMocks.putObject).toHaveBeenNthCalledWith(1, {
      Bucket: config.bucket,
      Region: config.region,
      Key: "knowledge/item.json",
      Body: Buffer.from('{"answer":42}', "utf8"),
      ContentType: "application/json",
    });
  });

  it("reads and parses JSON from the configured location", async () => {
    cosMocks.getObject.mockResolvedValue({
      Body: Buffer.from('{"title":"审计"}', "utf8"),
    });
    const { cosGetJson } = await loadStorage();

    await expect(
      cosGetJson<{ title: string }>("knowledge/item.json"),
    ).resolves.toEqual({ title: "审计" });
    expect(cosMocks.getObject).toHaveBeenCalledWith({
      Bucket: config.bucket,
      Region: config.region,
      Key: "knowledge/item.json",
    });
  });

  it.each([
    { statusCode: 404 },
    { code: "NoSuchKey" },
    { code: "NotFound" },
  ])("returns null for a missing object error %#", async (missingError) => {
    cosMocks.getObject.mockRejectedValue(missingError);
    const { cosGetJson } = await loadStorage();

    await expect(cosGetJson("missing.json")).resolves.toBeNull();
  });

  it("preserves non-missing getObject Promise failures", async () => {
    const providerError = Object.assign(new Error("COS unavailable"), {
      code: "ServiceUnavailable",
      statusCode: 503,
    });
    cosMocks.getObject.mockRejectedValue(providerError);
    const { cosGetJson } = await loadStorage();

    await expect(cosGetJson("knowledge/item.json")).rejects.toBe(providerError);
  });

  it("preserves putObject Promise failures", async () => {
    const providerError = Object.assign(new Error("write failed"), {
      code: "InternalError",
    });
    cosMocks.putObject.mockRejectedValue(providerError);
    const { cosPutJson } = await loadStorage();

    await expect(cosPutJson("knowledge/item.json", {})).rejects.toBe(
      providerError,
    );
  });

  it("deletes the exact server-derived object key", async () => {
    cosMocks.deleteObject.mockResolvedValue({ statusCode: 204 });
    const { cosDeleteObject } = await loadStorage();

    await cosDeleteObject(
      "knowledge-base-share/33333333-3333-4333-8333-333333333333.json",
    );

    expect(cosMocks.deleteObject).toHaveBeenCalledWith({
      Bucket: config.bucket,
      Region: config.region,
      Key: "knowledge-base-share/33333333-3333-4333-8333-333333333333.json",
    });
  });

  it("fails closed for writes and returns null for reads when COS is not configured", async () => {
    cosMocks.getConfig.mockReturnValue(null);
    const { cosGetJson, cosPutJson, isCosConfigured } = await loadStorage();

    expect(isCosConfigured()).toBe(false);
    await expect(cosGetJson("knowledge/item.json")).resolves.toBeNull();
    await expect(cosPutJson("knowledge/item.json", {})).rejects.toThrow(
      "Tencent COS is not configured",
    );
    expect(cosMocks.construct).not.toHaveBeenCalled();
  });

  it("pins the audited COS SDK v3 dependency contract", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies?.["cos-nodejs-sdk-v5"]).toBe("3.0.0");
  });
});
