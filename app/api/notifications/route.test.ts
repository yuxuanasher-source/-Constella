import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { listNotificationCenterItems } from "@/features/notifications/notification-center-queries";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/notifications/notification-center-queries", () => ({
  listNotificationCenterItems: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

describe("notifications route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns notification center items and unread count", async () => {
    vi.mocked(listNotificationCenterItems).mockResolvedValue([
      {
        id: "notice-1",
        type: "high_risk",
        status: "unread",
        title: "结算批次重开",
        content: "批次被 owner 重开",
        objectType: "settlement_batch",
        objectId: "batch-1",
        isHighRisk: true,
        createdAt: "2026-06-02T10:00:00.000Z",
      },
      {
        id: "notice-2",
        type: "task",
        status: "handled",
        title: "待审核报数",
        content: "主播提交了报数",
        objectType: "live_report",
        objectId: "report-1",
        isHighRisk: false,
        createdAt: "2026-06-02T11:00:00.000Z",
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/notifications?status=unread"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: expect.any(Array),
      unreadCount: 1,
    });
    expect(listNotificationCenterItems).toHaveBeenCalledWith(
      { client: "supabase" },
      {
        userId: "user-ops",
        role: "ops_manager",
        organizationId: "org-1",
      },
      { status: "unread" },
    );
  });
});
