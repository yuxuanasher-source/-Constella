import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { revokeProjectCollaborationShare } from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";

vi.mock("@/features/collaborations/project-collaboration-service", () => ({
  SupabaseProjectCollaborationRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "collaboration-repo" };
    }),
  revokeProjectCollaborationShare: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
  getAdmissionRouteContext: vi.fn(),
  jsonError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    ),
}));

const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "ops_manager" as const,
  organizationId: "org-owner",
};

describe("project collaboration share revoke route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      audit: vi.fn(),
    } as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(revokeProjectCollaborationShare).mockResolvedValue(undefined);
  });

  it("revokes a share through the collaboration service", async () => {
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ projectId: "project-1", shareId: "share-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(revokeProjectCollaborationShare).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        projectId: "project-1",
        shareId: "share-1",
      }),
    );
  });
});
