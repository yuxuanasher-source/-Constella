import { describe, expect, it } from "vitest";

import { jsonError } from "./application-route-utils";

describe("application route utils", () => {
  it("maps application service permission errors to 403 responses", async () => {
    const response = jsonError(
      new Error("Only streamers can apply to projects"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only streamers can apply to projects",
    });
  });
});
