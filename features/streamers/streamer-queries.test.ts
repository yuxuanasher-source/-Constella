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

    await listStreamerPool(client as never, "org-1");
    await getStreamerProfileRow(client as never, "streamer-1");

    expect(pool.select).toHaveBeenCalledWith(
      expect.stringContaining("streamer_profile_insights"),
    );
    expect(profile.select).toHaveBeenCalledWith(
      expect.stringContaining("streamer_profile_insights"),
    );
  });

  it("filters the pool by organization and bounds the main query", async () => {
    const pool = queryBuilder([]);
    const client = { from: vi.fn(() => pool) };

    await listStreamerPool(client as never, "org-1");

    expect(pool.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(pool.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(200);
  });

  it("bounds nested relations with per-streamer recency windows", async () => {
    const pool = queryBuilder([]);
    const client = { from: vi.fn(() => pool) };

    await listStreamerPool(client as never, "org-1");

    expect(pool.order).toHaveBeenCalledWith("created_at", {
      referencedTable: "recording_submissions",
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(50, {
      referencedTable: "recording_submissions",
    });
    expect(pool.order).toHaveBeenCalledWith("created_at", {
      referencedTable: "streamer_profile_insights",
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(20, {
      referencedTable: "streamer_profile_insights",
    });
    expect(pool.order).toHaveBeenCalledWith("created_at", {
      referencedTable: "live_tasks",
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(200, {
      referencedTable: "live_tasks",
    });
    expect(pool.order).toHaveBeenCalledWith("created_at", {
      referencedTable: "live_reports",
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(200, {
      referencedTable: "live_reports",
    });
  });
});

function queryBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return builder;
}
