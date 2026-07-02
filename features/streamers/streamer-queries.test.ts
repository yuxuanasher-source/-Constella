import { describe, expect, it, vi } from "vitest";

import { getStreamerProfileRow, listStreamerPool } from "./streamer-queries";

describe("streamer queries", () => {
  it("loads confirmed profile insights for pool cards and profile pages", async () => {
    const pool = queryBuilder([]);
    const profile = queryBuilder(null);
    const from = vi.fn((table: string) => {
      if (table !== "streamers") {
        throw new Error(`unexpected table ${table}`);
      }
      return from.mock.calls.length === 1 ? pool : profile;
    });
    const client = { from };

    await listStreamerPool(client as never);
    await getStreamerProfileRow(client as never, "streamer-1");

    expect(pool.select).toHaveBeenCalledWith(
      expect.stringContaining("streamer_profile_insights"),
    );
    expect(profile.select).toHaveBeenCalledWith(
      expect.stringContaining("streamer_profile_insights"),
    );
  });
});

function queryBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve({ data, error: null })),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })),
  };
  return builder;
}
