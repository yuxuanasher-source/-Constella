import { describe, expect, it } from "vitest";

import { jsonError } from "./live-operations-route-utils";

describe("live operations route utils", () => {
  it("preserves database error messages from plain PostgREST-style objects", async () => {
    const response = jsonError({
      code: "42703",
      message:
        "column streamer_public_project_announcements.is_public_to_streamers does not exist",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error:
        "column streamer_public_project_announcements.is_public_to_streamers does not exist",
    });
  });
});
