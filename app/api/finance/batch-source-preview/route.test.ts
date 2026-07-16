import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import { getSettlementRouteContext } from "@/features/settlements/settlement-route-utils";

import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  repo: {
    listStreamerPayableSources: vi.fn(),
  },
}));

vi.mock("@/features/settlements/settlement-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-route-utils")
  >("@/features/settlements/settlement-route-utils");

  return {
    ...actual,
    getSettlementRouteContext: vi.fn(),
  };
});

vi.mock("@/features/finance-batches/finance-batch-repository", () => ({
  SupabaseFinanceBatchRepository: vi.fn(function SupabaseFinanceBatchRepository() {
    return mocks.repo;
  }),
}));

const supabase = { client: "supabase" };

describe("finance batch source preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      auth: {
        userId: "user-finance",
        name: "Finance",
        role: "finance",
        organizationId: "org-1",
      },
      repo: { kind: "settlement-repo" },
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    mocks.repo.listStreamerPayableSources.mockResolvedValue([
      { id: "report-1", streamerId: "streamer-1" },
    ]);
  });

  it("previews streamer payable sources with organization scope and query filters", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/finance/batch-source-preview?batchType=streamer_payable&periodStart=2026-07-01&periodEnd=2026-07-31&projectIds=project-1,project-2&streamerIds=streamer-1&sourceIds=report-1",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sources: [{ id: "report-1", streamerId: "streamer-1" }],
    });
    expect(SupabaseFinanceBatchRepository).toHaveBeenCalledWith(supabase);
    expect(mocks.repo.listStreamerPayableSources).toHaveBeenCalledWith({
      organizationId: "org-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      projectIds: ["project-1", "project-2"],
      streamerIds: ["streamer-1"],
      sourceIds: ["report-1"],
    });
  });

  it("rejects preview requests for finance batch types that are not enabled", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/finance/batch-source-preview?batchType=receivable&periodStart=2026-07-01&periodEnd=2026-07-31",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "receivable finance batch source preview is not enabled yet",
    });
    expect(mocks.repo.listStreamerPayableSources).not.toHaveBeenCalled();
  });
});
