import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { createProjectDraft } from "@/features/projects/project-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));

vi.mock("@/features/projects/project-queries", () => ({
  listProjects: vi.fn(),
}));

vi.mock("@/features/projects/project-repository", () => ({
  SupabaseProjectRepository: vi.fn().mockImplementation(function () {
    return { repo: "project-repo" };
  }),
}));

vi.mock("@/features/projects/project-service", () => ({
  createProjectAuditWriter: vi.fn(() => vi.fn()),
  createProjectDraft: vi.fn(),
}));

vi.mock("@/features/projects/project-ui-dto", () => ({
  toProjectCardDtos: vi.fn((projects) => projects),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/http/route-error-status", () => ({
  statusForServiceError: vi.fn(() => 500),
}));

const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-owner",
};

describe("projects route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it("returns Supabase plain-object errors instead of a generic unexpected error", async () => {
    vi.mocked(createProjectDraft).mockRejectedValue({
      code: "42703",
      message: "column projects.is_open_to_mcn_collaboration does not exist",
    });

    const response = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: "New project",
          code: "P-NEW",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "column projects.is_open_to_mcn_collaboration does not exist",
    });
  });
});
