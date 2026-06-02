import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "./route";

import { updateNotificationStatus } from "@/features/notifications/notification-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/notifications/notification-service", () => ({
  updateNotificationStatus: vi.fn(),
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

describe("notification item route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("passes supported status actions into the service", async () => {
    vi.mocked(updateNotificationStatus).mockResolvedValue({
      id: "notice-1",
      title: "结算批次重开",
      status: "handled",
    });

    const response = await PATCH(
      new Request("http://localhost/api/notifications/notice-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "handled" }),
      }),
      { params: Promise.resolve({ notificationId: "notice-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      notification: {
        id: "notice-1",
        title: "结算批次重开",
        status: "handled",
      },
    });
    expect(updateNotificationStatus).toHaveBeenCalledWith({
      client: { client: "supabase" },
      auth,
      notificationId: "notice-1",
      action: "handled",
    });
  });

  it("rejects unsupported actions before calling the service", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/notifications/notice-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "delete" }),
      }),
      { params: Promise.resolve({ notificationId: "notice-1" }) },
    );

    expect(response.status).toBe(400);
    expect(updateNotificationStatus).not.toHaveBeenCalled();
  });
});
