import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  actorFromContext,
  getAdmissionRouteContext,
} from "@/features/applications/application-route-utils";
import { SupabaseApplicationRepository } from "@/features/applications/application-repository";
import { inviteStreamerToProject } from "@/features/applications/application-service";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/applications/application-service", () => ({
  inviteStreamerToProject: vi.fn(),
}));

vi.mock("@/features/applications/application-repository", () => ({
  SupabaseApplicationRepository: vi.fn().mockImplementation(function (client) {
    return {
      repo: "application-repo",
      client,
    };
  }),
}));

vi.mock("@/features/applications/application-route-utils", () => ({
  actorFromContext: vi.fn(),
  getAdmissionRouteContext: vi.fn(),
  readJsonBody: async (request: Request) => request.json(),
  requiredString: (body: Record<string, unknown>, key: string) => {
    const value = body[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${key} is required`);
    }
    return value.trim();
  },
  optionalString: (body: Record<string, unknown>, key: string) => {
    const value = body[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  },
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

const actor = {
  userId: "user-partner",
  name: "Partner",
  role: "ops_manager" as const,
  organizationId: "org-partner",
};

describe("project invitations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      repo: { repo: "application-repo" },
      auth: actor,
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(actorFromContext).mockReturnValue(actor);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin-supabase",
    } as never);
    vi.mocked(inviteStreamerToProject).mockResolvedValue({
      id: "application-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "invited",
    } as never);
  });

  it("forwards optional collaboration attribution when inviting a streamer", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/project-1/invitations", {
        method: "POST",
        body: JSON.stringify({
          streamerId: "streamer-1",
          collaborationId: "agreement-1",
        }),
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      application: expect.objectContaining({ id: "application-1" }),
    });
    expect(inviteStreamerToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: {
          repo: "application-repo",
          client: { client: "admin-supabase" },
        },
        actor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          collaborationId: "agreement-1",
        },
      }),
    );
    expect(SupabaseApplicationRepository).toHaveBeenCalledWith({
      client: "admin-supabase",
    });
  });

  it("uses the session client for owner-only invitations", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/project-1/invitations", {
        method: "POST",
        body: JSON.stringify({ streamerId: "streamer-1" }),
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(201);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(SupabaseApplicationRepository).toHaveBeenCalledWith({
      client: "supabase",
    });
    expect(inviteStreamerToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: { repo: "application-repo", client: { client: "supabase" } },
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          collaborationId: undefined,
        },
      }),
    );
  });

  it("fails closed when collaboration attribution needs the admin client but it is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await POST(
      new Request("http://localhost/api/projects/project-1/invitations", {
        method: "POST",
        body: JSON.stringify({
          streamerId: "streamer-1",
          collaborationId: "agreement-1",
        }),
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Collaboration service is unavailable",
    });
    expect(inviteStreamerToProject).not.toHaveBeenCalled();
  });
});
