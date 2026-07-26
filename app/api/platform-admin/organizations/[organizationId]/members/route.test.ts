import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlatformOrganizationMember } from "@/features/platform-admin/platform-admin-organization-service";

import { getPlatformAdminRouteContext } from "../../../route-context";
import { POST } from "./route";

vi.mock("../../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));

vi.mock(
  "@/features/platform-admin/platform-admin-organization-service",
  () => ({
    createPlatformOrganizationMember: vi.fn(),
  }),
);

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: { auth: { admin: {} } },
  repo: {},
  mutationRepo: { repo: "platform-mutation" },
};

describe("platform-admin organization members route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
  });

  it("creates a child account through the governed service", async () => {
    vi.mocked(createPlatformOrganizationMember).mockResolvedValue({
      member: { id: "member-1" },
    } as never);

    const response = await POST(
      new Request(
        "https://example.cn/api/platform-admin/organizations/org-1/members",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "invite",
            email: "ops@xingyao.cn",
            name: "运营",
            role: "operator_business",
            reason: "补充运营账号",
            idempotencyKey: "member-1",
          }),
        },
      ),
      { params: Promise.resolve({ organizationId: "org-1" }) },
    );

    expect(response.status).toBe(201);
    expect(createPlatformOrganizationMember).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: context.mutationRepo,
        actor: context.actor,
        organizationId: "org-1",
      }),
    );
  });
});
