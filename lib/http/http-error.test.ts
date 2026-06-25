import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "./parse-json-body";
import { toHttpError } from "./http-error";

describe("toHttpError", () => {
  it("keeps validation errors as controlled 400 responses", () => {
    expect(toHttpError(new ValidationError("Invalid request body"))).toEqual({
      status: 400,
      message: "Invalid request body",
    });
  });

  it("keeps explicit route errors controlled", () => {
    expect(
      toHttpError({
        message: "Collaboration service is unavailable",
        statusCode: 503,
      }),
    ).toEqual({
      status: 503,
      message: "Collaboration service is unavailable",
    });
  });

  it("sanitizes unknown program errors", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(toHttpError(new Error("database password leaked"))).toEqual({
      status: 500,
      message: "Unexpected error",
    });
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });
});
