import { describe, expect, it, vi } from "vitest";

import { listProjects } from "./project-queries";

type QueryMock = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then: (
    resolve: (value: { data: unknown[]; error: null }) => unknown,
  ) => Promise<unknown>;
};

function createQueryMock(): QueryMock {
  const query: QueryMock = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return query;
}

describe("listProjects", () => {
  it("applies the organization filter from the required option", async () => {
    const query = createQueryMock();
    const supabase = {
      from: vi.fn(() => query),
    };

    await listProjects(supabase as never, { organizationId: "org-1" });

    expect(supabase.from).toHaveBeenCalledWith("projects");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(200);
  });

  it("bounds nested settlement relations to existence checks", async () => {
    const query = createQueryMock();
    const supabase = {
      from: vi.fn(() => query),
    };

    await listProjects(supabase as never, { organizationId: "org-1" });

    expect(query.limit).toHaveBeenCalledWith(1, {
      referencedTable: "settlement_batches",
    });
    expect(query.limit).toHaveBeenCalledWith(1, {
      referencedTable: "live_reports",
    });
    // live_reports 只取会命中 hasApprovedPoolReport 谓词的行。
    expect(query.eq).toHaveBeenCalledWith("live_reports.status", "approved");
    expect(query.is).toHaveBeenCalledWith(
      "live_reports.settled_batch_item_id",
      null,
    );
    expect(query.or).toHaveBeenCalledWith(
      "enter_settlement_pool.is.null,enter_settlement_pool.eq.true",
      { referencedTable: "live_reports" },
    );
  });

  it("returns an empty list without a client", async () => {
    await expect(
      listProjects(null, { organizationId: "org-1" }),
    ).resolves.toEqual([]);
  });
});
