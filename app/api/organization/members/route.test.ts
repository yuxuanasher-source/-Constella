import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import {
  createOrganizationMember,
  listOrganizationMembers,
} from "@/features/organizations/organization-service";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { getAuthContext } from "@/lib/auth/context";

vi.mock("@/features/organizations/organization-service", () => ({
  createOrganizationMember: vi.fn(),
  listOrganizationMembers: vi.fn(),
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
  createSupabaseAdminClient: vi.fn(),
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

describe("organization members route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { createUser: vi.fn(), inviteUserByEmail: vi.fn() } },
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns organization-scoped members", async () => {
    vi.mocked(listOrganizationMembers).mockResolvedValue([
      {
        id: "member-1",
        organizationId: "org-1",
        userId: "user-owner",
        email: "owner@example.com",
        name: "Owner",
        role: "owner",
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      members: expect.any(Array),
      organization: {
        id: "org-1",
        name: "Demo Org",
      },
      permissions: {
        actorRole: "owner",
        canViewMembers: true,
        canCreateMembers: true,
        creatableRoles: [
          "owner",
          "ops_manager",
          "operator_business",
          "finance",
          "streamer",
        ],
      },
    });
    expect(listOrganizationMembers).toHaveBeenCalledWith(
      expect.objectContaining({ actor: auth }),
    );
  });

  it("returns organization identity and permissions without listing members when role cannot view members", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "finance",
      organizationName: "Finance Org",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      members: [],
      organization: {
        id: "org-1",
        name: "Finance Org",
      },
      permissions: {
        actorRole: "finance",
        canViewMembers: false,
        canCreateMembers: false,
        creatableRoles: [],
      },
    });
    expect(listOrganizationMembers).not.toHaveBeenCalled();
  });

  it("creates an invited member through the service", async () => {
    vi.mocked(createOrganizationMember).mockResolvedValue({
      member: {
        id: "member-invite",
        organizationId: "org-1",
        userId: "user-invite",
        email: "invite@example.com",
        name: "Invite",
        role: "operator_business",
        status: "invited",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/organization/members", {
        method: "POST",
        body: JSON.stringify({
          mode: "invite",
          email: "invite@example.com",
          name: "Invite",
          role: "operator_business",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createOrganizationMember).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: auth,
        input: expect.objectContaining({
          mode: "invite",
          email: "invite@example.com",
          role: "operator_business",
        }),
      }),
    );
  });

  it("creates generated subaccounts without requiring email or temporaryPassword from the caller", async () => {
    vi.mocked(createOrganizationMember).mockResolvedValue({
      member: {
        id: "member-sub",
        organizationId: "org-1",
        userId: "user-sub",
        email: "jy-sub-001@subaccount.local",
        name: "Sub",
        role: "streamer",
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      credentials: {
        account: "jy-sub-001",
        password: "A1b2C3d4",
        requiresActivation: true,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/organization/members", {
        method: "POST",
        body: JSON.stringify({
          mode: "subaccount",
          name: "Sub",
          role: "streamer",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      credentials: {
        account: "jy-sub-001",
        password: "A1b2C3d4",
        requiresActivation: true,
      },
    });
    expect(createOrganizationMember).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          mode: "subaccount",
          email: undefined,
          temporaryPassword: undefined,
        }),
      }),
    );
  });

  it("returns localized permission errors for blocked account creation", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "finance",
    });
    vi.mocked(createOrganizationMember).mockRejectedValue(
      new Error("Current role cannot create streamer accounts"),
    );

    const response = await POST(
      new Request("http://localhost/api/organization/members", {
        method: "POST",
        body: JSON.stringify({
          mode: "subaccount",
          name: "Blocked Streamer",
          role: "streamer",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "当前角色无权创建主播账号",
    });
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });
});
