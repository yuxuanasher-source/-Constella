import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteObject: vi.fn() }));

vi.mock("cos-nodejs-sdk-v5", () => ({
  default: class MockCos {
    deleteObject = mocks.deleteObject;
  },
}));
vi.mock("@/lib/config/env", () => ({
  getTencentCosConfig: () => ({
    secretId: "secret-id",
    secretKey: "secret-key",
    bucket: "bucket-123",
    region: "ap-test",
  }),
}));

import { cosDeleteObject } from "./tencent-cos";

describe("Tencent COS deletion", () => {
  beforeEach(() => {
    mocks.deleteObject.mockReset().mockResolvedValue({ statusCode: 204 });
  });

  it("deletes the exact server-derived object key", async () => {
    await cosDeleteObject(
      "knowledge-base-share/33333333-3333-4333-8333-333333333333.json",
    );

    expect(mocks.deleteObject).toHaveBeenCalledWith({
      Bucket: "bucket-123",
      Region: "ap-test",
      Key: "knowledge-base-share/33333333-3333-4333-8333-333333333333.json",
    });
  });
});
