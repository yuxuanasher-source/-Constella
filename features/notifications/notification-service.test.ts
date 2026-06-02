import { describe, expect, it, vi } from "vitest";

import { updateNotificationStatus } from "./notification-service";

function createClient() {
  const updatePayloads: Record<string, unknown>[] = [];
  const insertPayloads: Record<string, unknown>[] = [];

  const notificationQuery = {
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayloads.push(payload);
      return notificationQuery;
    }),
    eq: vi.fn(() => notificationQuery),
    select: vi.fn(() => notificationQuery),
    single: vi.fn(async () => ({
      data: {
        id: "notice-1",
        title: "结算批次重开",
        status: "handled",
      },
      error: null,
    })),
  };

  const auditQuery = {
    insert: vi.fn(async (payload: Record<string, unknown>) => {
      insertPayloads.push(payload);
      return { error: null };
    }),
  };

  return {
    client: {
      from: vi.fn((table: string) =>
        table === "audit_logs" ? auditQuery : notificationQuery,
      ),
    },
    updatePayloads,
    insertPayloads,
    notificationQuery,
  };
}

describe("notification service", () => {
  it("updates status inside organization scope and writes audit", async () => {
    const { client, updatePayloads, insertPayloads, notificationQuery } =
      createClient();

    await updateNotificationStatus({
      client,
      auth: {
        userId: "user-ops",
        organizationId: "org-1",
        role: "ops_manager",
        name: "运营经理",
      },
      notificationId: "notice-1",
      action: "handled",
    });

    expect(updatePayloads).toEqual([{ status: "handled" }]);
    expect(notificationQuery.eq).toHaveBeenCalledWith("id", "notice-1");
    expect(notificationQuery.eq).toHaveBeenCalledWith(
      "organization_id",
      "org-1",
    );
    expect(insertPayloads).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        actor_user_id: "user-ops",
        action: "update",
        module: "notification",
        object_type: "notification",
        object_id: "notice-1",
        changed_fields: ["status"],
      }),
    ]);
  });

  it("rejects unsupported notification actions", async () => {
    const { client } = createClient();

    await expect(
      updateNotificationStatus({
        client,
        auth: {
          userId: "user-ops",
          organizationId: "org-1",
          role: "ops_manager",
          name: "运营经理",
        },
        notificationId: "notice-1",
        action: "delete" as never,
      }),
    ).rejects.toThrow("Unsupported notification action");
  });
});
