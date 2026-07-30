import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { rotateAdmissionShareBoardToken } from "@/features/applications/admission-share-board";
import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";

vi.mock("@/features/applications/admission-share-board", () => ({
  SupabaseAdmissionShareBoardRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "share-repo" };
    }),
  rotateAdmissionShareBoardToken: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
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

const auth = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};
const context = {
  supabase: { client: "supabase" },
  auth,
  audit: vi.fn(),
};
const params = Promise.resolve({
  projectId: "project-1",
  shareBoardId: "share-1",
});

describe("rotate admission share-board token route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue(context as never);
    vi.mocked(actorFromContext).mockReturnValue(auth);
    vi.mocked(rotateAdmissionShareBoardToken).mockResolvedValue({
      token: "new-plain-token",
    });
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("returns the new public URL once without a separate plaintext token field", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";

    const response = await POST(
      new Request("http://localhost/api", { method: "POST" }),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      shareUrl: "https://app.example/share/admission/new-plain-token",
    });
    expect(rotateAdmissionShareBoardToken).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        projectId: "project-1",
        shareBoardId: "share-1",
      }),
    );
  });

  it("blocks non-MCN roles before generating a replacement token", async () => {
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      ...context,
      auth: { ...auth, role: "streamer" },
    } as never);

    const response = await POST(
      new Request("http://localhost/api", { method: "POST" }),
      { params },
    );

    expect(response.status).toBe(403);
    expect(rotateAdmissionShareBoardToken).not.toHaveBeenCalled();
  });
});
