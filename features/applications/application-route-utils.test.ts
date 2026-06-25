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

  it("preserves database error messages from plain PostgREST-style objects", async () => {
    const response = jsonError({
      code: "22P02",
      message:
        'invalid input value for enum audit_action: "create_share_board"',
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid input value for enum audit_action: "create_share_board"',
    });
  });
});
