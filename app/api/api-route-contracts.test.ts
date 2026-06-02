import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as startLiveTaskPost } from "./live-tasks/[taskId]/start/route";
import { POST as settlementBatchPost } from "./settlement-batches/route";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
} from "@/features/live-operations/live-operations-route-utils";
import { startLiveTask } from "@/features/live-operations/live-operations-service";
import { getSettlementRouteContext } from "@/features/settlements/settlement-route-utils";
import { generateSettlementBatch } from "@/features/settlements/settlement-service";

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
  startLiveTask: vi.fn(),
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

vi.mock("@/features/settlements/settlement-service", () => ({
  generateSettlementBatch: vi.fn(),
}));

const supabase = { client: "supabase" };

const liveActor = {
  userId: "user-streamer",
  name: "Streamer",
  role: "streamer" as const,
  organizationId: "org-1",
  streamerId: "streamer-1",
};

const settlementAuth = {
  userId: "user-finance",
  name: "Finance",
  role: "finance" as const,
  organizationId: "org-1",
};

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("api route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue({
      supabase,
      auth: {
        userId: liveActor.userId,
        name: liveActor.name,
        role: liveActor.role,
        organizationId: liveActor.organizationId,
      },
      repo: {},
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(actorFromContext).mockResolvedValue(liveActor);

    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      auth: settlementAuth,
      repo: {},
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
  });

  it("returns 403 when the live-task start service rejects a role permission", async () => {
    vi.mocked(startLiveTask).mockRejectedValueOnce(
      new Error("Current role cannot operate live tasks"),
    );

    const response = await startLiveTaskPost(
      jsonRequest("http://localhost/api/live-tasks/task-1/start", {
        now: "2026-06-02T10:00:00.000Z",
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Current role cannot operate live tasks",
    });
    expect(startLiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: liveActor,
        taskId: "task-1",
        now: "2026-06-02T10:00:00.000Z",
      }),
    );
  });

  it("returns 403 when settlement batch generation rejects a role permission", async () => {
    vi.mocked(generateSettlementBatch).mockRejectedValueOnce(
      new Error("Current role cannot manage settlement batches"),
    );

    const response = await settlementBatchPost(
      jsonRequest("http://localhost/api/settlement-batches", {
        projectId: "project-1",
        batchType: "payable",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Current role cannot manage settlement batches",
    });
    expect(generateSettlementBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          userId: "user-finance",
          name: "Finance",
          role: "finance",
          organizationId: "org-1",
        },
        input: {
          projectId: "project-1",
          batchType: "payable",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        },
      }),
    );
  });
});
