import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformAdminContext } from "./platform-admin-auth";
import {
  hashPlatformAdminRequest,
  type PlatformAdminOperationLog,
} from "./platform-admin-operation-log";
import {
  createPlatformOrganization,
  createPlatformOrganizationMember,
  setPlatformOrganizationLifecycle,
  updatePlatformOrganizationMember,
  type PlatformAdminMutationRepository,
  type PlatformOrganizationAuthAdmin,
} from "./platform-admin-organization-service";

const actor: PlatformAdminContext = {
  userId: "admin-user",
  email: "admin@example.com",
  name: "平台管理员",
  role: "super_admin",
};

function createLog(): PlatformAdminOperationLog {
  return {
    findByIdempotency: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
  };
}

function createRepo(
  overrides: Partial<PlatformAdminMutationRepository> = {},
): PlatformAdminMutationRepository {
  return {
    operationLog: createLog(),
    createOrganizationAtomic: vi.fn(async () => ({
      organizationId: "org-1",
      subscriptionId: "sub-1",
      primaryUserId: "primary-user",
      orderId: null,
      transactionId: null,
    })),
    getOrganization: vi.fn(async () => ({
      id: "org-1",
      name: "安澜传媒",
      code: "anlan",
      lifecycleStatus: "active" as const,
      updatedAt: "2026-07-26T08:00:00.000Z",
    })),
    updateOrganizationLifecycle: vi.fn(async (_id, status) => ({
      id: "org-1",
      name: "安澜传媒",
      code: "anlan",
      lifecycleStatus: status,
      updatedAt: "2026-07-26T09:00:00.000Z",
    })),
    updateOrganizationIdentity: vi.fn(),
    createOrUpdateProfile: vi.fn(async () => undefined),
    createMembership: vi.fn(async (input) => ({
      id: "member-new",
      organizationId: input.organizationId,
      userId: input.userId,
      email: "new@example.com",
      name: "新增账号",
      role: input.role,
      status: input.status,
      createdAt: "2026-07-26T08:00:00.000Z",
      updatedAt: "2026-07-26T08:00:00.000Z",
    })),
    getMember: vi.fn(async () => ({
      id: "member-1",
      organizationId: "org-1",
      userId: "primary-user",
      email: "owner@anlan.cn",
      name: "安澜负责人",
      role: "owner" as const,
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-07-26T08:00:00.000Z",
    })),
    updateMemberRole: vi.fn(),
    updateMemberStatus: vi.fn(),
    isPrimaryAccount: vi.fn(async () => true),
    countOtherActiveOwners: vi.fn(async () => 0),
    ...overrides,
  };
}

function createAuthAdmin(
  overrides: Partial<PlatformOrganizationAuthAdmin> = {},
): PlatformOrganizationAuthAdmin {
  return {
    createUser: vi.fn(async () => ({
      data: {
        user: {
          id: "primary-user",
          email: "owner@anlan.cn",
        },
      },
      error: null,
    })),
    inviteUserByEmail: vi.fn(async () => ({
      data: {
        user: {
          id: "invited-user",
          email: "new@example.com",
        },
      },
      error: null,
    })),
    deleteUser: vi.fn(async () => ({ error: null })),
    sendPasswordReset: vi.fn(async () => undefined),
    ...overrides,
  };
}

const createCommand = {
  name: "安澜传媒",
  code: "anlan",
  primaryEmail: "owner@anlan.cn",
  primaryName: "安澜负责人",
  primaryPassword: "Secret123",
  planId: "plan-pro",
  billingCycle: "monthly" as const,
  periodStart: "2026-07-26",
  periodEnd: "2026-08-25",
  offlinePayment: null,
  reason: "新签客户开通",
  traceId: "trace-create-1",
  idempotencyKey: "create-anlan",
};

describe("createPlatformOrganization", () => {
  it("creates the auth user before calling the atomic organization RPC", async () => {
    const callOrder: string[] = [];
    const authAdmin = createAuthAdmin({
      createUser: vi.fn(async () => {
        callOrder.push("auth");
        return {
          data: {
            user: { id: "primary-user", email: "owner@anlan.cn" },
          },
          error: null,
        };
      }),
    });
    const repo = createRepo({
      createOrganizationAtomic: vi.fn(async () => {
        callOrder.push("rpc");
        return {
          organizationId: "org-1",
          subscriptionId: "sub-1",
          primaryUserId: "primary-user",
          orderId: null,
          transactionId: null,
        };
      }),
    });

    await createPlatformOrganization({
      repo,
      authAdmin,
      actor,
      command: createCommand,
    });

    expect(callOrder).toEqual(["auth", "rpc"]);
    expect(repo.createOrganizationAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-user",
        primaryUserId: "primary-user",
        idempotencyKey: "create-anlan",
      }),
    );
  });

  it("deletes the newly created auth user when the RPC fails", async () => {
    const authAdmin = createAuthAdmin();
    const repo = createRepo({
      createOrganizationAtomic: vi.fn(async () => {
        throw new Error("RPC failed");
      }),
    });

    await expect(
      createPlatformOrganization({
        repo,
        authAdmin,
        actor,
        command: createCommand,
      }),
    ).rejects.toThrow("RPC failed");

    expect(authAdmin.deleteUser).toHaveBeenCalledWith("primary-user");
    expect(repo.operationLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization.create",
        result: "failure",
        errorMessage: "RPC failed",
      }),
    );
  });

  it("returns a matching successful idempotent result before creating auth", async () => {
    const result = {
      organizationId: "org-existing",
      subscriptionId: "sub-existing",
      primaryUserId: "primary-existing",
      orderId: null,
      transactionId: null,
    };
    const requestHash = hashPlatformAdminRequest({
      ...createCommand,
      traceId: undefined,
    });
    const log = createLog();
    vi.mocked(log.findByIdempotency).mockResolvedValue({
      requestHash,
      result: "success",
      resultValue: result,
    });
    const repo = createRepo({ operationLog: log });
    const authAdmin = createAuthAdmin();

    await expect(
      createPlatformOrganization({
        repo,
        authAdmin,
        actor,
        command: createCommand,
      }),
    ).resolves.toEqual(result);

    expect(authAdmin.createUser).not.toHaveBeenCalled();
    expect(repo.createOrganizationAtomic).not.toHaveBeenCalled();
  });
});

describe("organization lifecycle and accounts", () => {
  it("requires reason and optimistic updatedAt when freezing", async () => {
    const repo = createRepo();

    await expect(
      setPlatformOrganizationLifecycle({
        repo,
        actor,
        organizationId: "org-1",
        status: "frozen",
        expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
        reason: " ",
        idempotencyKey: "freeze-1",
      }),
    ).rejects.toThrow("reason");
    expect(repo.updateOrganizationLifecycle).not.toHaveBeenCalled();
  });

  it("adds another owner without changing the unique primary account", async () => {
    const repo = createRepo();
    const authAdmin = createAuthAdmin();

    await createPlatformOrganizationMember({
      repo,
      authAdmin,
      actor,
      organizationId: "org-1",
      command: {
        mode: "invite",
        email: "new@example.com",
        name: "新增负责人",
        role: "owner",
        reason: "增加联合负责人",
        idempotencyKey: "member-owner-1",
      },
    });

    expect(repo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ role: "owner" }),
    );
    expect(repo.isPrimaryAccount).not.toHaveBeenCalled();
  });

  it("rejects new accounts for archived organizations", async () => {
    const repo = createRepo({
      getOrganization: vi.fn(async () => ({
        id: "org-1",
        name: "安澜传媒",
        code: "anlan",
        lifecycleStatus: "archived" as const,
        updatedAt: "2026-07-26T08:00:00.000Z",
      })),
    });

    await expect(
      createPlatformOrganizationMember({
        repo,
        authAdmin: createAuthAdmin(),
        actor,
        organizationId: "org-1",
        command: {
          mode: "invite",
          email: "new@example.com",
          name: "新增账号",
          role: "operator_business",
          reason: "补充运营",
          idempotencyKey: "member-1",
        },
      }),
    ).rejects.toThrow("Archived");
  });

  it("rejects suspending the only active primary owner", async () => {
    const repo = createRepo();

    await expect(
      updatePlatformOrganizationMember({
        repo,
        authAdmin: createAuthAdmin(),
        actor,
        organizationId: "org-1",
        memberId: "member-1",
        command: {
          status: "suspended",
          expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
          reason: "账号异常",
          idempotencyKey: "suspend-primary",
        },
      }),
    ).rejects.toThrow("active owner");
    expect(repo.updateMemberStatus).not.toHaveBeenCalled();
  });

  it("audits sending a child-account password reset", async () => {
    const log = createLog();
    const repo = createRepo({
      operationLog: log,
      getMember: vi.fn(async () => ({
        id: "member-2",
        organizationId: "org-1",
        userId: "child-user",
        email: "child@anlan.cn",
        name: "子账号",
        role: "operator_business" as const,
        status: "active" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-07-26T08:00:00.000Z",
      })),
      isPrimaryAccount: vi.fn(async () => false),
    });
    const authAdmin = createAuthAdmin();

    await updatePlatformOrganizationMember({
      repo,
      authAdmin,
      actor,
      organizationId: "org-1",
      memberId: "member-2",
      command: {
        sendPasswordReset: true,
        expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
        reason: "用户申请重置",
        idempotencyKey: "reset-child",
      },
    });

    expect(authAdmin.sendPasswordReset).toHaveBeenCalledWith(
      "child@anlan.cn",
    );
    expect(log.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization.member.password_reset",
        result: "success",
      }),
    );
  });
});
