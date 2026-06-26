import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  confirmProjectCollaborationCounter,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/collaborations/project-collaboration-service", () => ({
  SupabaseProjectCollaborationRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "collaboration-repo" };
    }),
  confirmProjectCollaborationCounter: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
  getAdmissionRouteContext: vi.fn(),
  jsonError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
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

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const auth = {
  userId: "user-partner",
  name: "Partner",
  role: "ops_manager" as const,
  organizationId: "org-partner",
};

describe("project collaboration counter confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      audit: vi.fn(),
    } as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin-supabase",
    } as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(confirmProjectCollaborationCounter).mockResolvedValue({
      application: { id: "application-1", status: "approved" },
      agreement: { id: "agreement-1", status: "active" },
    } as never);
  });

  it("confirms a counter offer as the applicant organization", async () => {
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({
        projectId: "project-1",
        applicationId: "application-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      application: expect.objectContaining({ id: "application-1" }),
      agreement: expect.objectContaining({ id: "agreement-1" }),
    });
    expect(confirmProjectCollaborationCounter).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        projectId: "project-1",
        applicationId: "application-1",
      }),
    );
    expect(SupabaseProjectCollaborationRepository).toHaveBeenCalledWith({
      client: "admin-supabase",
    });
  });

  it("fails closed when the admin collaboration client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({
        projectId: "project-1",
        applicationId: "application-1",
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Collaboration service is unavailable",
    });
    expect(confirmProjectCollaborationCounter).not.toHaveBeenCalled();
  });
});
