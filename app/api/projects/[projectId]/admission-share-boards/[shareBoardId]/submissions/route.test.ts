import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  getAdmissionRouteContext,
  type AdmissionRouteContext,
} from "@/features/applications/application-route-utils";

const { listReviewSubmissions } = vi.hoisted(() => ({
  listReviewSubmissions: vi.fn(),
}));

vi.mock("@/features/applications/admission-share-board", () => ({
  SupabaseAdmissionShareBoardRepository: vi
    .fn()
    .mockImplementation(function () {
      return {
        listReviewSubmissions,
      };
    }),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  getAdmissionRouteContext: vi.fn(),
  jsonError: (error: unknown) => {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status },
    );
  },
  RouteError: class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));

const params = Promise.resolve({
  projectId: "project-1",
  shareBoardId: "share-1",
});
const context = {
  supabase: { client: "supabase" },
  auth: {
    userId: "user-ops",
    role: "ops_manager",
    organizationId: "org-1",
  },
} as unknown as AdmissionRouteContext;

describe("admission share submission history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context);
    listReviewSubmissions.mockResolvedValue([
      {
        id: "submission-1",
        revision: 2,
        projectRemark: "首轮复核完成",
        submittedAt: "2026-07-30T10:00:00.000Z",
        summary: {
          selected: 1,
          backup: 0,
          rejected: 1,
          needsChanges: 0,
        },
        items: [
          {
            applicationId: "app-1",
            recordingSubmissionId: "recording-1",
            recordingVersion: 2,
            decision: "selected",
            remark: "适合",
            reasonCodes: [],
            syncStatus: "synced",
            syncError: null,
          },
        ],
      },
    ]);
  });

  it("returns immutable submission history without reviewer contact fields", async () => {
    const response = await GET(new Request("http://localhost/api"), { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.submissions).toHaveLength(1);
    expect(body.submissions[0]).toMatchObject({
      revision: 2,
      summary: { selected: 1, rejected: 1 },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /reviewer(?:name|contact)|vendor_reviewer/iu,
    );
    expect(listReviewSubmissions).toHaveBeenCalledWith("project-1", "share-1");
  });

  it("blocks non-MCN roles before reading history", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "streamer" },
    } as AdmissionRouteContext);
    const response = await GET(new Request("http://localhost/api"), { params });

    expect(response.status).toBe(403);
    expect(listReviewSubmissions).not.toHaveBeenCalled();
  });
});
