import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPlatformOrganizations } from "@/features/platform-admin/platform-admin-read-service";
import { createPlatformOrganization } from "@/features/platform-admin/platform-admin-organization-service";

import { getPlatformAdminRouteContext } from "../route-context";
import { GET, POST } from "./route";

vi.mock("../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));

vi.mock("@/features/platform-admin/platform-admin-read-service", () => ({
  listPlatformOrganizations: vi.fn(),
}));

vi.mock(
  "@/features/platform-admin/platform-admin-organization-service",
  () => ({
    createPlatformOrganization: vi.fn(),
  }),
);

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: { auth: { admin: {} } },
  repo: { repo: "platform" },
  mutationRepo: { repo: "platform-mutation" },
};

describe("platform-admin organizations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(listPlatformOrganizations).mockResolvedValue({
      items: [],
      meta: { page: 2, pageSize: 25, total: 0 },
    });
  });

  it("rejects an invalid page", async () => {
    const response = await GET(
      new Request("https://example.cn/api/platform-admin/organizations?page=0"),
    );

    expect(response.status).toBe(400);
  });

  it("returns a paged organization DTO", async () => {
    const response = await GET(
      new Request(
        "https://example.cn/api/platform-admin/organizations?page=2&pageSize=25&search=%E6%98%9F%E8%80%80&lifecycleStatus=active&start=2026-07-01&end=2026-07-31",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      meta: { page: 2, pageSize: 25, total: 0 },
    });
    expect(listPlatformOrganizations).toHaveBeenCalledWith({
      repo: context.repo,
      query: {
        page: 2,
        pageSize: 25,
        search: "星耀",
        lifecycleStatus: "active",
        period: { start: "2026-07-01", end: "2026-07-31" },
      },
    });
  });

  it("creates an organization through the governed service", async () => {
    vi.mocked(createPlatformOrganization).mockResolvedValue({
      organizationId: "org-1",
      subscriptionId: "sub-1",
      primaryUserId: "user-1",
      orderId: null,
      transactionId: null,
    });
    const body = {
      name: "星耀传媒",
      code: "xingyao",
      primaryEmail: "owner@xingyao.cn",
      primaryName: "星耀负责人",
      primaryPassword: "Secret123",
      planId: "11111111-1111-4111-8111-111111111111",
      billingCycle: "monthly",
      periodStart: "2026-07-26",
      periodEnd: "2026-08-25",
      offlinePayment: null,
      reason: "新签客户",
      idempotencyKey: "create-xingyao",
    };

    const response = await POST(
      new Request("https://example.cn/api/platform-admin/organizations", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(201);
    expect(createPlatformOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: context.actor,
        repo: context.mutationRepo,
        command: body,
        authAdmin: expect.objectContaining({
          createUser: expect.any(Function),
          deleteUser: expect.any(Function),
        }),
      }),
    );
  });
});
