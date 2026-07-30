import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { listAdmissionShareCandidates } from "@/features/applications/admission-share-candidates";
import { preflightAdmissionShareSelection } from "@/features/applications/admission-share-workflow";
import { getAdmissionRouteContext } from "@/features/applications/application-route-utils";

vi.mock("@/features/applications/admission-share-candidates", () => ({
  SupabaseAdmissionShareCandidateRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "candidate-repo" };
    }),
  listAdmissionShareCandidates: vi.fn(),
}));

vi.mock("@/features/applications/admission-share-workflow", () => ({
  preflightAdmissionShareSelection: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  getAdmissionRouteContext: vi.fn(),
  readJsonBody: async (request: Request) => request.json(),
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

const context = {
  supabase: { client: "supabase" },
  auth: {
    userId: "user-ops",
    name: "Ops",
    role: "ops_manager" as const,
    organizationId: "org-1",
  },
};

const routeParams = {
  params: Promise.resolve({ projectId: "project-1" }),
};

describe("admission share preflight route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(listAdmissionShareCandidates).mockResolvedValue([]);
    vi.mocked(preflightAdmissionShareSelection).mockReturnValue({
      items: [
        {
          applicationId: "app-1",
          recordingSubmissionId: "recording-v1",
          recordingVersion: 1,
          sortOrder: 0,
          status: "blocked",
          sourceHealth: "blocked",
          reasonCode: "SELECTION_STALE",
        },
      ],
      summary: { ready: 0, warning: 0, blocked: 1 },
    });
  });

  it("returns item-level blocked results with status 200", async () => {
    const items = [
      {
        applicationId: "app-1",
        recordingSubmissionId: "recording-v1",
        recordingVersion: 1,
        sortOrder: 0,
      },
    ];
    const response = await POST(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-boards/preflight",
        {
          method: "POST",
          body: JSON.stringify({ items }),
        },
      ),
      routeParams,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { blocked: 1 },
    });
    expect(listAdmissionShareCandidates).toHaveBeenCalledWith(
      { repo: "candidate-repo" },
      {
        organizationId: "org-1",
        projectId: "project-1",
      },
    );
    expect(preflightAdmissionShareSelection).toHaveBeenCalledWith([], items);
  });

  it("rejects malformed selection DTOs", async () => {
    const response = await POST(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-boards/preflight",
        {
          method: "POST",
          body: JSON.stringify({
            items: [
              {
                applicationId: "app-1",
                recordingSubmissionId: "recording-v1",
                recordingVersion: "1",
                sortOrder: 0,
              },
            ],
          }),
        },
      ),
      routeParams,
    );

    expect(response.status).toBe(400);
    expect(listAdmissionShareCandidates).not.toHaveBeenCalled();
  });

  it("blocks streamers before querying candidates", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "streamer" },
    } as never);

    const response = await POST(
      new Request(
        "https://app.example/api/projects/project-1/admission-share-boards/preflight",
        {
          method: "POST",
          body: JSON.stringify({ items: [] }),
        },
      ),
      routeParams,
    );

    expect(response.status).toBe(403);
    expect(listAdmissionShareCandidates).not.toHaveBeenCalled();
  });
});
