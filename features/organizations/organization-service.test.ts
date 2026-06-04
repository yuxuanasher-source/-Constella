import { describe, expect, it, vi } from "vitest";

import {
  createOrganizationMember,
  listOrganizationMembers,
  updateOrganizationMemberRole,
  updateOrganizationMemberStatus,
} from "./organization-service";

const owner = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

const opsManager = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

const operatorBusiness = {
  userId: "user-operator",
  name: "Operator",
  role: "operator_business" as const,
  organizationId: "org-1",
};

describe("organization service", () => {
  it("lists only members from the actor organization", async () => {
    const repo = {
      listMembers: vi.fn().mockResolvedValue([
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
      ]),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn(),
      getMemberById: vi.fn(),
      updateMemberRole: vi.fn(),
    };

    const members = await listOrganizationMembers({ repo, actor: owner });

    expect(repo.listMembers).toHaveBeenCalledWith("org-1");
    expect(members).toHaveLength(1);
  });

  it("keeps historical demo seed members out of the organization member list", async () => {
    const repo = {
      listMembers: vi.fn().mockResolvedValue([
        {
          id: "member-demo-owner",
          organizationId: "org-1",
          userId: "11111111-1111-1111-1111-111111111111",
          email: "owner@jy-demo.local",
          name: "Owner",
          role: "owner",
          status: "active",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "member-demo-ops",
          organizationId: "org-1",
          userId: "22222222-2222-2222-2222-222222222222",
          email: "ops@jy-demo.local",
          name: "Ops Manager",
          role: "ops_manager",
          status: "active",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "member-real",
          organizationId: "org-1",
          userId: "user-real",
          email: "finance@example.com",
          name: "Finance User",
          role: "finance",
          status: "active",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ]),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn(),
      getMemberById: vi.fn(),
      updateMemberRole: vi.fn(),
    };

    const members = await listOrganizationMembers({ repo, actor: owner });

    expect(members).toEqual([
      expect.objectContaining({
        id: "member-real",
        email: "finance@example.com",
      }),
    ]);
  });

  it("blocks organization member reads for non-admin roles", async () => {
    const repo = {
      listMembers: vi.fn(),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn(),
      getMemberById: vi.fn(),
      updateMemberRole: vi.fn(),
    };

    await expect(
      listOrganizationMembers({
        repo,
        actor: { ...owner, role: "finance" },
      }),
    ).rejects.toThrow("Current role cannot view organization members");
  });

  it("creates an invited member through the auth invitation flow", async () => {
    const repo = {
      listMembers: vi.fn(),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn().mockResolvedValue({
        id: "member-invite",
        organizationId: "org-1",
        userId: "user-invite",
        email: "new@example.com",
        name: "New Member",
        role: "operator_business",
        status: "invited",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
      getMemberById: vi.fn(),
      updateMemberRole: vi.fn(),
      updateMemberStatus: vi.fn(),
    };
    const authAdmin = {
      inviteUserByEmail: vi.fn().mockResolvedValue({
        data: { user: { id: "user-invite", email: "new@example.com" } },
        error: null,
      }),
      createUser: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    const result = await createOrganizationMember({
      repo,
      authAdmin,
      audit,
      actor: owner,
      input: {
        mode: "invite",
        email: " new@example.com ",
        name: " New Member ",
        role: "operator_business",
      },
    });

    expect(result.credentials).toBeUndefined();
    expect(authAdmin.inviteUserByEmail).toHaveBeenCalledWith(
      "new@example.com",
      expect.objectContaining({
        data: expect.objectContaining({ full_name: "New Member" }),
      }),
    );
    expect(repo.createOrUpdateProfile).toHaveBeenCalledWith({
      userId: "user-invite",
      email: "new@example.com",
      name: "New Member",
    });
    expect(repo.createMembership).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-invite",
      role: "operator_business",
      status: "invited",
    });
    expect(result.member.status).toBe("invited");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        module: "organization",
        objectType: "organization_member",
        changedFields: ["email", "role", "status"],
      }),
    );
  });

  it("creates an active subaccount with a generated default account and 8-character password", async () => {
    const repo = {
      listMembers: vi.fn(),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn().mockResolvedValue({
        id: "member-sub",
        organizationId: "org-1",
        userId: "user-sub",
        email: "jy-ops-001@subaccount.local",
        name: "Sub Account",
        role: "finance",
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
      getMemberById: vi.fn(),
      updateMemberRole: vi.fn(),
      updateMemberStatus: vi.fn(),
    };
    const authAdmin = {
      inviteUserByEmail: vi.fn(),
      createUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-sub", email: "jy-ops-001@subaccount.local" } },
        error: null,
      }),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    const result = await createOrganizationMember({
      repo,
      authAdmin,
      audit,
      actor: owner,
      generateDefaultAccount: () => "jy-ops-001",
      generateDefaultPassword: () => "A1b2C3d4",
      input: {
        mode: "subaccount",
        email: "",
        name: "Sub Account",
        role: "finance",
      },
    });

    expect(authAdmin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jy-ops-001@subaccount.local",
        password: "A1b2C3d4",
        email_confirm: true,
        user_metadata: expect.objectContaining({
          default_account: "jy-ops-001",
          onboarding_required: true,
        }),
      }),
    );
    expect(repo.createOrUpdateProfile).toHaveBeenCalledWith({
      userId: "user-sub",
      email: "jy-ops-001@subaccount.local",
      name: "Sub Account",
      loginAccount: "jy-ops-001",
      phone: null,
      requiresOnboarding: true,
    });
    expect(result.member.status).toBe("active");
    expect(result.credentials).toEqual({
      account: "jy-ops-001",
      password: "A1b2C3d4",
      requiresActivation: true,
    });
  });

  it("allows ops_manager and operator_business to create only their permitted account roles", async () => {
    const createRepo = () => ({
      listMembers: vi.fn(),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn().mockResolvedValue({
        id: "member-streamer",
        organizationId: "org-1",
        userId: "user-streamer",
        email: "streamer@example.com",
        name: "Streamer",
        role: "streamer",
        status: "invited",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
      getMemberById: vi.fn(),
      updateMemberRole: vi.fn(),
      updateMemberStatus: vi.fn(),
    });
    const authAdmin = {
      inviteUserByEmail: vi.fn().mockResolvedValue({
        data: { user: { id: "user-streamer", email: "streamer@example.com" } },
        error: null,
      }),
      createUser: vi.fn(),
    };

    await expect(
      createOrganizationMember({
        repo: createRepo(),
        authAdmin,
        audit: vi.fn(),
        actor: opsManager,
        input: {
          mode: "invite",
          email: "streamer@example.com",
          name: "Streamer",
          role: "streamer",
        },
      }),
    ).resolves.toMatchObject({ member: { role: "streamer" } });

    await expect(
      createOrganizationMember({
        repo: createRepo(),
        authAdmin,
        audit: vi.fn(),
        actor: opsManager,
        input: {
          mode: "invite",
          email: "finance@example.com",
          name: "Finance",
          role: "finance",
        },
      }),
    ).rejects.toThrow("Current role cannot create finance accounts");

    await expect(
      createOrganizationMember({
        repo: createRepo(),
        authAdmin,
        audit: vi.fn(),
        actor: operatorBusiness,
        input: {
          mode: "invite",
          email: "ops@example.com",
          name: "Ops",
          role: "operator_business",
        },
      }),
    ).rejects.toThrow(
      "Current role cannot create operator_business accounts",
    );
  });

  it("rejects member creation from finance", async () => {
    const repo = {
      listMembers: vi.fn(),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn(),
      getMemberById: vi.fn(),
      updateMemberRole: vi.fn(),
      updateMemberStatus: vi.fn(),
    };
    const authAdmin = {
      inviteUserByEmail: vi.fn(),
      createUser: vi.fn(),
    };

    await expect(
      createOrganizationMember({
        repo,
        authAdmin,
        audit: vi.fn(),
        actor: { ...owner, role: "finance" },
        input: {
          mode: "invite",
          email: "blocked@example.com",
          name: "Blocked",
          role: "streamer",
        },
      }),
    ).rejects.toThrow("Current role cannot create streamer accounts");
  });

  it("updates member roles inside the actor organization and writes audit", async () => {
    const before = {
      id: "member-2",
      organizationId: "org-1",
      userId: "user-finance",
      email: "finance@example.com",
      name: "Finance",
      role: "finance" as const,
      status: "active" as const,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    const after = { ...before, role: "ops_manager" as const };
    const repo = {
      listMembers: vi.fn(),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn(),
      getMemberById: vi.fn().mockResolvedValue(before),
      updateMemberRole: vi.fn().mockResolvedValue(after),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    const member = await updateOrganizationMemberRole({
      repo,
      audit,
      actor: owner,
      memberId: before.id,
      role: "ops_manager",
      reason: "运营负责人接管项目审批",
    });

    expect(repo.getMemberById).toHaveBeenCalledWith("org-1", "member-2");
    expect(repo.updateMemberRole).toHaveBeenCalledWith("org-1", "member-2", {
      role: "ops_manager",
    });
    expect(member.role).toBe("ops_manager");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "organization",
        objectType: "organization_member",
        objectId: "member-2",
        changedFields: ["role"],
        isHighRisk: true,
        reason: "运营负责人接管项目审批",
      }),
    );
  });

  it("suspends members inside the actor organization and writes audit", async () => {
    const before = {
      id: "member-2",
      organizationId: "org-1",
      userId: "user-finance",
      email: "finance@example.com",
      name: "Finance",
      role: "finance" as const,
      status: "active" as const,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    const after = { ...before, status: "suspended" as const };
    const repo = {
      listMembers: vi.fn(),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn(),
      getMemberById: vi.fn().mockResolvedValue(before),
      updateMemberRole: vi.fn(),
      updateMemberStatus: vi.fn().mockResolvedValue(after),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    const member = await updateOrganizationMemberStatus({
      repo,
      audit,
      actor: owner,
      memberId: before.id,
      status: "suspended",
      reason: "离职停用账号",
    });

    expect(repo.updateMemberStatus).toHaveBeenCalledWith("org-1", "member-2", {
      status: "suspended",
    });
    expect(member.status).toBe("suspended");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "organization",
        objectType: "organization_member",
        objectId: "member-2",
        changedFields: ["status"],
        isHighRisk: true,
        reason: "离职停用账号",
      }),
    );
  });

  it("rejects suspending the current owner account", async () => {
    const repo = {
      listMembers: vi.fn(),
      createOrUpdateProfile: vi.fn(),
      createMembership: vi.fn(),
      getMemberById: vi.fn().mockResolvedValue({
        id: "member-owner",
        organizationId: "org-1",
        userId: "user-owner",
        email: "owner@example.com",
        name: "Owner",
        role: "owner",
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
      updateMemberRole: vi.fn(),
      updateMemberStatus: vi.fn(),
    };

    await expect(
      updateOrganizationMemberStatus({
        repo,
        audit: vi.fn(),
        actor: owner,
        memberId: "member-owner",
        status: "suspended",
        reason: "self suspend",
      }),
    ).rejects.toThrow("Owner cannot suspend their own organization account");
    expect(repo.updateMemberStatus).not.toHaveBeenCalled();
  });
});
