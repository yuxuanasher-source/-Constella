import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPlatformOrganizations } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminRouteContext } from "../route-context";
import { GET } from "./route";

vi.mock("../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));

vi.mock("@/features/platform-admin/platform-admin-read-service", () => ({
  listPlatformOrganizations: vi.fn(),
}));

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: { repo: "platform" },
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
});
