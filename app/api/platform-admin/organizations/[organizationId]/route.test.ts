import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformOrganizationDetail,
  PlatformAdminNotFoundError,
} from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminRouteContext } from "../../route-context";
import { GET } from "./route";

vi.mock("../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));

vi.mock("@/features/platform-admin/platform-admin-read-service", () => ({
  getPlatformOrganizationDetail: vi.fn(),
  PlatformAdminNotFoundError: class PlatformAdminNotFoundError extends Error {},
}));

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: { repo: "platform" },
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
});
