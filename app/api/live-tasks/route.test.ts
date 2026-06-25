import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
} from "@/features/live-operations/live-operations-route-utils";
import { createLiveTask } from "@/features/live-operations/live-operations-service";

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
  createLiveTask: vi.fn(),
}));

const actor = {
  userId: "user-ops",
  name: "Ops",
  role: "operator_business" as const,
  organizationId: "org-partner",
  streamerId: null,
};
const context = {
  supabase: { client: "supabase" },
  auth: actor,
  repo: { repo: "live-operations" },
  audit: vi.fn(),
  notify: vi.fn(),
};

describe("/api/live-tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(actorFromContext).mockResolvedValue(actor);
    vi.mocked(createLiveTask).mockResolvedValue({
      id: "task-1",
      status: "pending_live",
    } as never);
  });

  it("forwards optional collaboration attribution when creating a task", async () => {
    const response = await POST(
      new Request("http://localhost/api/live-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          streamerId: "streamer-1",
          title: "Partner task",
          taskType: "project",
          plannedStartAt: "2026-06-02T10:00:00.000Z",
          plannedEndAt: "2026-06-02T12:00:00.000Z",
          plannedDuration: 120,
          collaborationId: "agreement-1",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createLiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: context.repo,
        actor,
        input: expect.objectContaining({
          projectId: "project-1",
          streamerId: "streamer-1",
          collaborationId: "agreement-1",
        }),
      }),
    );
  });
});
