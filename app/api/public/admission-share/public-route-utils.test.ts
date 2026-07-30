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
});
