import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "./route";

import {
  updateOrganizationMemberRole,
  updateOrganizationMemberStatus,
} from "@/features/organizations/organization-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/organizations/organization-service", () => ({
  updateOrganizationMemberRole: vi.fn(),
  updateOrganizationMemberStatus: vi.fn(),
}));

vi.mock("@/features/organizations/organization-repository", () => ({
  SupabaseOrganizationMemberRepository: vi.fn(function () {
    return {
      repo: "organization-members",
    };
  }),
}));

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-owner",
  email: "owner@example.com",
  name: "Owner",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "owner" as const,
};

describe("organization member detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("updates a member role through the service", async () => {
    vi.mocked(updateOrganizationMemberRole).mockResolvedValue({
      id: "member-2",
      organizationId: "org-1",
      userId: "user-finance",
      email: "finance@example.com",
      name: "Finance",
      role: "ops_manager",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    const response = await PATCH(
      new Request("http://localhost/api/organization/members/member-2", {
        method: "PATCH",
        body: JSON.stringify({
          role: "ops_manager",
          reason: "接管项目审批",
        }),
      }),
      { params: Promise.resolve({ memberId: "member-2" }) },
    );

    expect(response.status).toBe(200);
    expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        memberId: "member-2",
        role: "ops_manager",
        reason: "接管项目审批",
      }),
    );
  });

  it("updates a member status through the service", async () => {
    vi.mocked(updateOrganizationMemberStatus).mockResolvedValue({
      id: "member-2",
      organizationId: "org-1",
      userId: "user-finance",
      email: "finance@example.com",
      name: "Finance",
      role: "finance",
      status: "suspended",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    const response = await PATCH(
      new Request("http://localhost/api/organization/members/member-2", {
        method: "PATCH",
        body: JSON.stringify({
          status: "suspended",
          reason: "离职停用账号",
        }),
      }),
      { params: Promise.resolve({ memberId: "member-2" }) },
    );

    expect(response.status).toBe(200);
    expect(updateOrganizationMemberStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        memberId: "member-2",
        status: "suspended",
        reason: "离职停用账号",
      }),
    );
  });

  it("rejects unauthenticated role updates", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://localhost/api/organization/members/member-2", {
        method: "PATCH",
        body: JSON.stringify({
          role: "finance",
          reason: "test",
        }),
      }),
      { params: Promise.resolve({ memberId: "member-2" }) },
    );

    expect(response.status).toBe(401);
  });
});
