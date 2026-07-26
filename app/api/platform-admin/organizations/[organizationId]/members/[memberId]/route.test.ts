import { beforeEach, describe, expect, it, vi } from "vitest";

import { updatePlatformOrganizationMember } from "@/features/platform-admin/platform-admin-organization-service";

import { getPlatformAdminRouteContext } from "../../../../route-context";
import { PATCH } from "./route";

vi.mock("../../../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));

vi.mock(
  "@/features/platform-admin/platform-admin-organization-service",
  () => ({
    updatePlatformOrganizationMember: vi.fn(),
  }),
);

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: { auth: { admin: {} } },
  repo: {},
  mutationRepo: { repo: "platform-mutation" },
};

describe("platform-admin organization member route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
  });

  it("rejects bodies containing more than one member action", async () => {
    const response = await PATCH(
      new Request(
        "https://example.cn/api/platform-admin/organizations/org-1/members/member-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            role: "finance",
            status: "suspended",
            expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
            reason: "岗位变化",
            idempotencyKey: "member-change-1",
          }),
        },
      ),
      {
        params: Promise.resolve({
          organizationId: "org-1",
          memberId: "member-1",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(updatePlatformOrganizationMember).not.toHaveBeenCalled();
  });

  it("delegates exactly one member action", async () => {
    vi.mocked(updatePlatformOrganizationMember).mockResolvedValue({
      id: "member-1",
    } as never);

    const response = await PATCH(
      new Request(
        "https://example.cn/api/platform-admin/organizations/org-1/members/member-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            sendPasswordReset: true,
            expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
            reason: "用户申请重置",
            idempotencyKey: "member-reset-1",
          }),
        },
      ),
      {
        params: Promise.resolve({
          organizationId: "org-1",
          memberId: "member-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(updatePlatformOrganizationMember).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: context.mutationRepo,
        actor: context.actor,
        organizationId: "org-1",
        memberId: "member-1",
      }),
    );
  });
});
