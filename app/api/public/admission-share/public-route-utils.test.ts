import { describe, expect, it, vi } from "vitest";

import { PublicAdmissionShareError } from "@/features/applications/admission-share-board";

import { publicAdmissionShareErrorResponse } from "./public-route-utils";

describe("public admission share route errors", () => {
  it("returns a stable localized response for typed public errors", async () => {
    const response = publicAdmissionShareErrorResponse(
      new PublicAdmissionShareError(
        "ACCESS_RATE_LIMITED",
        "internal rate-limit detail",
        429,
        900,
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("900");
    await expect(response.json()).resolves.toEqual({
      code: "ACCESS_RATE_LIMITED",
      error: "尝试次数过多，请稍后再试。",
      retryAfterSeconds: 900,
    });
  });

  it("maps known service errors without exposing their internal messages", async () => {
    const response = publicAdmissionShareErrorResponse(
      new Error("Recording version is stale"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "RECORDING_VERSION_STALE",
      error: "录屏版本已更新，请刷新页面后重新提交。",
    });
  });

  it("logs unknown failures and returns an opaque service error", async () => {
    const logger = vi.fn();
    const response = publicAdmissionShareErrorResponse(
      new TypeError("fetch failed: database.internal"),
      logger,
    );

    expect(logger).toHaveBeenCalledWith(
      "Public admission share route failed",
      expect.any(TypeError),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "SHARE_SERVICE_UNAVAILABLE",
      error: "分享服务暂时不可用，请稍后重试。",
    });
  });

  it.each([
    ["DRAFT_CONFLICT", 409, "其他复核人刚刚更新了结果，请刷新后查看最新内容。"],
    ["DRAFT_SAVE_FAILED", 503, "草稿暂时无法保存，请保留页面并稍后重试。"],
    ["REVIEW_ALREADY_LOCKED", 409, "本轮结果已经提交并锁定。"],
  ] as const)(
    "maps %s to a stable public response",
    async (code, status, error) => {
      const response = publicAdmissionShareErrorResponse(
        new PublicAdmissionShareError(code, "internal detail", status),
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ code, error });
    },
  );
});
