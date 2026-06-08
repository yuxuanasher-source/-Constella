import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as liveReportsGet } from "./live-reports/route";
import { GET as liveTasksGet } from "./live-tasks/route";

import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
} from "@/features/live-operations/live-operations-queries";
import { getLiveOperationsRouteContext } from "@/features/live-operations/live-operations-route-utils";

vi.mock("@/features/live-operations/live-operations-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/live-operations/live-operations-route-utils")
  >("@/features/live-operations/live-operations-route-utils");

  return {
    ...actual,
    getLiveOperationsRouteContext: vi.fn(),
  };
});

vi.mock("@/features/live-operations/live-operations-queries", () => ({
  listOpsLiveReportQueue: vi.fn(),
  listOpsLiveTaskQueue: vi.fn(),
}));

const supabase = { client: "supabase" };

describe("live queue refresh routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue({
      supabase,
      auth: {
        userId: "user-owner",
        name: "Owner",
        role: "owner",
        organizationId: "org-current",
      },
      repo: {},
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);

    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([]);
    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([]);
  });

  it("refreshes the ops task queue inside the current organization", async () => {
    const response = await liveTasksGet();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tasks: [] });
    expect(listOpsLiveTaskQueue).toHaveBeenCalledWith(supabase, "org-current");
  });

  it("refreshes the ops report queue inside the current organization", async () => {
    const response = await liveReportsGet();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reports: [] });
    expect(listOpsLiveReportQueue).toHaveBeenCalledWith(
      supabase,
      "org-current",
    );
  });
});
