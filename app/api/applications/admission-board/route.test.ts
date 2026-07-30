import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { listAdmissionProjectBoards } from "@/features/applications/admission-board";
import { getAdmissionRouteContext } from "@/features/applications/application-route-utils";

vi.mock("@/features/applications/admission-board", () => ({
  listAdmissionProjectBoards: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  getAdmissionRouteContext: vi.fn(),
  jsonError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      {
        status:
          error instanceof Error && error.message.includes("Only MCN staff")
            ? 403
            : 500,
      },
    ),
  RouteError: class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));

const context = {
  supabase: { client: "supabase" },
  auth: {
    userId: "user-ops",
    name: "Ops",
    role: "ops_manager",
    organizationId: "org-1",
  },
};

describe("admission board route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(listAdmissionProjectBoards).mockResolvedValue([
      {
        project: {
          id: "project-1",
          code: "P-001",
          name: "Alpha",
          status: "active",
          vendor: "Vendor",
          product: "Game",
        },
        counts: {
          totalApplications: 1,
          recordingCount: 1,
          mcnPendingReview: 1,
          mcnApproved: 0,
          mcnRejected: 0,
          needsChanges: 0,
          vendorPending: 1,
          vendorSelected: 0,
          vendorBackup: 0,
          vendorRejected: 0,
          vendorNeedsChanges: 0,
          pendingFinalConfirm: 0,
        },
        share: {
          id: null,
          mode: null,
          status: "unshared",
          reviewState: null,
          roundNumber: null,
          expiresAt: null,
          lastViewedAt: null,
          lastDraftAt: null,
          lastSubmittedAt: null,
          lockedAt: null,
        },
        shareProgress: { completed: 0, total: 0 },
        lastActivityAt: "2026-06-07T01:00:00.000Z",
      },
    ]);
  });

  it("returns project-first admission boards for MCN staff", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projects: [
        expect.objectContaining({
          project: expect.objectContaining({ id: "project-1" }),
          share: expect.objectContaining({
            mode: null,
            reviewState: null,
            roundNumber: null,
          }),
          shareProgress: { completed: 0, total: 0 },
        }),
      ],
    });
    expect(listAdmissionProjectBoards).toHaveBeenCalledWith(
      { client: "supabase" },
      "org-1",
    );
  });

  it("blocks streamers", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "streamer" },
    } as never);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(listAdmissionProjectBoards).not.toHaveBeenCalled();
  });
});
