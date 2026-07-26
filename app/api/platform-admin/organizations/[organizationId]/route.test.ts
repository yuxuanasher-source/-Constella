import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformOrganizationDetail,
  PlatformAdminNotFoundError,
} from "@/features/platform-admin/platform-admin-read-service";
import {
  setPlatformOrganizationLifecycle,
  updatePlatformOrganizationIdentity,
} from "@/features/platform-admin/platform-admin-organization-service";
import { PlatformAdminConflictError } from "@/features/platform-admin/platform-admin-errors";

import { getPlatformAdminRouteContext } from "../../route-context";
import { GET, PATCH } from "./route";

vi.mock("../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));

vi.mock("@/features/platform-admin/platform-admin-read-service", () => ({
  getPlatformOrganizationDetail: vi.fn(),
  PlatformAdminNotFoundError: class PlatformAdminNotFoundError extends Error {},
}));

vi.mock(
  "@/features/platform-admin/platform-admin-organization-service",
  () => ({
    setPlatformOrganizationLifecycle: vi.fn(),
    updatePlatformOrganizationIdentity: vi.fn(),
  }),
);

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: { repo: "platform" },
  mutationRepo: { repo: "platform-mutation" },
};

describe("platform-admin organization detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
  });

  it("returns 404 for a missing organization", async () => {
    vi.mocked(getPlatformOrganizationDetail).mockRejectedValue(
      new PlatformAdminNotFoundError("Organization", "missing"),
    );

    const response = await GET(
      new Request(
        "https://example.cn/api/platform-admin/organizations/missing?start=2026-07-01&end=2026-07-31",
      ),
      { params: Promise.resolve({ organizationId: "missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns the exact organization detail DTO", async () => {
    const detail = { id: "org-1", name: "星耀传媒" };
    vi.mocked(getPlatformOrganizationDetail).mockResolvedValue(detail as never);

    const response = await GET(
      new Request(
        "https://example.cn/api/platform-admin/organizations/org-1?start=2026-07-01&end=2026-07-31",
      ),
      { params: Promise.resolve({ organizationId: "org-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: detail });
  });

  it("delegates a lifecycle change with concurrency and governance fields", async () => {
    vi.mocked(setPlatformOrganizationLifecycle).mockResolvedValue({
      id: "org-1",
      name: "星耀传媒",
      code: "xingyao",
      lifecycleStatus: "frozen",
      updatedAt: "2026-07-26T09:00:00.000Z",
    });

    const response = await PATCH(
      new Request(
        "https://example.cn/api/platform-admin/organizations/org-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            lifecycleStatus: "frozen",
            expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
            reason: "合同到期",
            idempotencyKey: "freeze-org-1",
          }),
        },
      ),
      { params: Promise.resolve({ organizationId: "org-1" }) },
    );

    expect(response.status).toBe(200);
    expect(setPlatformOrganizationLifecycle).toHaveBeenCalledWith({
      repo: context.mutationRepo,
      actor: context.actor,
      organizationId: "org-1",
      status: "frozen",
      expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
      reason: "合同到期",
      idempotencyKey: "freeze-org-1",
    });
  });

  it("maps stale organization edits to 409", async () => {
    vi.mocked(updatePlatformOrganizationIdentity).mockRejectedValue(
      new PlatformAdminConflictError("stale"),
    );

    const response = await PATCH(
      new Request(
        "https://example.cn/api/platform-admin/organizations/org-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            name: "星耀传媒集团",
            expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
            reason: "工商名称变更",
            idempotencyKey: "rename-org-1",
          }),
        },
      ),
      { params: Promise.resolve({ organizationId: "org-1" }) },
    );

    expect(response.status).toBe(409);
  });
});
