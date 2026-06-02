import { describe, expect, it, vi } from "vitest";

import {
  listNotificationCenterItems,
  toNotificationCenterItem,
  type NotificationCenterRow,
} from "./notification-center-queries";

function createClient(rows: NotificationCenterRow[]) {
  const calls: Array<[string, unknown[]]> = [];
  const or = vi.fn((filter: string) => {
    calls.push(["or", [filter]]);
    return query;
  });
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((key: string, value: unknown) => {
      calls.push(["eq", [key, value]]);
      return query;
    }),
    or,
    order: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };

  return {
    client: {
      from: vi.fn(() => query),
    },
    calls,
  };
}

describe("notification center queries", () => {
  it("maps database rows to camelCase notification center items", () => {
    expect(
      toNotificationCenterItem({
        id: "notice-1",
        notification_type: "high_risk",
        status: "unread",
        title: "结算批次重开",
        content: "批次被 owner 重开",
        object_type: "settlement_batch",
        object_id: "batch-1",
        is_high_risk: true,
        created_at: "2026-06-02T10:00:00.000Z",
      }),
    ).toEqual({
      id: "notice-1",
      type: "high_risk",
      status: "unread",
      title: "结算批次重开",
      content: "批次被 owner 重开",
      objectType: "settlement_batch",
      objectId: "batch-1",
      isHighRisk: true,
      createdAt: "2026-06-02T10:00:00.000Z",
    });
  });

  it("lists notifications scoped to the actor user or role", async () => {
    const { client, calls } = createClient([]);

    await listNotificationCenterItems(client, {
      userId: "user-ops",
      role: "ops_manager",
      organizationId: "org-1",
    });

    expect(calls).toContainEqual(["eq", ["organization_id", "org-1"]]);
    expect(calls).toContainEqual([
      "or",
      ["recipient_user_id.eq.user-ops,recipient_role.eq.ops_manager"],
    ]);
  });

  it("can filter notification center by status", async () => {
    const { client, calls } = createClient([]);

    await listNotificationCenterItems(
      client,
      {
        userId: "user-ops",
        role: "ops_manager",
        organizationId: "org-1",
      },
      { status: "unread" },
    );

    expect(calls).toContainEqual(["eq", ["status", "unread"]]);
  });
});
