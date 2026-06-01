import { describe, expect, it, vi } from "vitest";

import { writeAuditLog } from "./audit";

function createInsertClient() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return {
    client: {
      from: vi.fn(() => ({ insert })),
    },
    insert,
  };
}

describe("writeAuditLog", () => {
  it("requires a reason for high-risk actions", async () => {
    const { client } = createInsertClient();

    await expect(
      writeAuditLog(client, {
        organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        action: "update",
        module: "settlement",
        objectType: "settlement_batch",
        isHighRisk: true,
      }),
    ).rejects.toThrow("High-risk audit logs require a reason");
  });

  it("inserts append-only audit payloads", async () => {
    const { client, insert } = createInsertClient();

    await writeAuditLog(client, {
      organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      actorUserId: "11111111-1111-1111-1111-111111111111",
      actorRole: "owner",
      action: "publish",
      module: "project",
      objectType: "project",
      objectId: "99999999-9999-9999-9999-999999999999",
      after: { status: "recruiting" },
      changedFields: ["status", "published_at"],
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        actor_role: "owner",
        action: "publish",
        module: "project",
        changed_fields: ["status", "published_at"],
      }),
    );
  });
});
