import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listPlatformAudit,
  listPlatformOrders,
  listPlatformPlans,
  listPlatformUsers,
} from "@/features/platform-admin/platform-admin-read-service";

import { GET as getAudit } from "./audit/route";
import { GET as getOrders } from "./orders/route";
import { GET as getPlans } from "./plans/route";
import { getPlatformAdminRouteContext } from "./route-context";
import { GET as getUsers } from "./users/route";

vi.mock("./route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));

vi.mock("@/features/platform-admin/platform-admin-read-service", () => ({
  listPlatformAudit: vi.fn(),
  listPlatformOrders: vi.fn(),
  listPlatformPlans: vi.fn(),
  listPlatformUsers: vi.fn(),
}));

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: { repo: "platform" },
};

describe("remaining platform-admin read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(listPlatformUsers).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
    vi.mocked(listPlatformPlans).mockResolvedValue([]);
    vi.mocked(listPlatformOrders).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
    vi.mocked(listPlatformAudit).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
  });

  it("returns a paged user collection", async () => {
    const response = await getUsers(
      new Request(
        "https://example.cn/api/platform-admin/users?organizationId=org-1&role=owner&page=1&pageSize=20",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
    expect(listPlatformUsers).toHaveBeenCalledWith({
      repo: context.repo,
      query: {
        organizationId: "org-1",
        role: "owner",
        page: 1,
        pageSize: 20,
      },
    });
  });

  it("returns plan performance for the reporting period", async () => {
    const response = await getPlans(
      new Request(
        "https://example.cn/api/platform-admin/plans?start=2026-07-01&end=2026-07-31",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(listPlatformPlans).toHaveBeenCalledWith({
      repo: context.repo,
      period: { start: "2026-07-01", end: "2026-07-31" },
    });
  });

  it("returns paged orders without provider payloads", async () => {
    const response = await getOrders(
      new Request(
        "https://example.cn/api/platform-admin/orders?status=paid&start=2026-07-01&end=2026-07-31",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
  });

  it("returns paged platform audit records", async () => {
    const response = await getAudit(
      new Request(
        "https://example.cn/api/platform-admin/audit?result=success&start=2026-07-01&end=2026-07-31",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
  });

  it("rejects an excessive page size", async () => {
    const response = await getUsers(
      new Request(
        "https://example.cn/api/platform-admin/users?page=1&pageSize=101",
      ),
    );

    expect(response.status).toBe(400);
    expect(listPlatformUsers).not.toHaveBeenCalled();
  });
});
