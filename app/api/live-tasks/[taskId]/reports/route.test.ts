import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
} from "@/features/live-operations/live-operations-route-utils";
import { submitLiveReport } from "@/features/live-operations/live-operations-service";

vi.mock("@/features/live-operations/live-operations-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/live-operations/live-operations-route-utils")
  >("@/features/live-operations/live-operations-route-utils");

  return {
    ...actual,
    actorFromContext: vi.fn(),
    getLiveOperationsRouteContext: vi.fn(),
  };
});

vi.mock("@/features/live-operations/live-operations-service", () => ({
  submitLiveReport: vi.fn(),
}));

const actor = {
  userId: "user-streamer",
  name: "Streamer",
  role: "streamer" as const,
  organizationId: "org-partner",
  streamerId: "streamer-1",
};
const context = {
  supabase: { client: "supabase" },
  auth: actor,
  repo: { repo: "live-operations" },
  audit: vi.fn(),
  notify: vi.fn(),
};

describe("/api/live-tasks/[taskId]/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(actorFromContext).mockResolvedValue(actor);
    vi.mocked(submitLiveReport).mockResolvedValue({
      id: "report-1",
      status: "pending_review",
    } as never);
  });

  it("forwards optional collaboration attribution when submitting a report", async () => {
    const response = await POST(
      new Request("http://localhost/api/live-tasks/task-1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshotStoragePath: "private/reports/task-1/end.png",
          screenshotFileHash: "hash-1",
          screenshotDuration: 122,
          claimedDuration: 122,
          viewers: 952,
          collaborationId: "agreement-1",
        }),
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );

    expect(response.status).toBe(201);
    expect(actorFromContext).toHaveBeenCalledWith(context, true);
    expect(submitLiveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: context.repo,
        actor,
        taskId: "task-1",
        input: expect.objectContaining({
          screenshotStoragePath: "private/reports/task-1/end.png",
          collaborationId: "agreement-1",
        }),
      }),
    );
  });
});
