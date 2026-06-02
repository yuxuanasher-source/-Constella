import { describe, expect, it, vi } from "vitest";

import {
  listAuditCenterEntries,
  toAuditCenterEntry,
  type AuditCenterActor,
  type AuditCenterRow,
} from "./audit-center-queries";

const owner: AuditCenterActor = {
  userId: "user-owner",
  role: "owner",
  organizationId: "org-1",
};

function createClient(rows: AuditCenterRow[]) {
  const calls: Array<[string, unknown[]]> = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((key: string, value: unknown) => {
      calls.push(["eq", [key, value]]);
      return query;
    }),
    in: vi.fn((key: string, value: unknown[]) => {
      calls.push(["in", [key, value]]);
      return query;
    }),
    order: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };

  return {
    client: {
      from: vi.fn(() => query),
    },
    query,
    calls,
  };
}

describe("audit center queries", () => {
  it("maps audit rows into a safe camelCase DTO", () => {
    const entry = toAuditCenterEntry({
      id: "audit-1",
      organization_id: "org-1",
      actor_user_id: "user-1",
      actor_name: "Ops Manager",
      actor_role: "ops_manager",
      action: "reopen",
      module: "settlement",
      object_type: "settlement_batch",
      object_id: "batch-1",
      object_name: "Batch 1",
      project_id: "project-1",
      streamer_id: null,
      changed_fields: ["status", "reopen_reason"],
      reason: "结算金额修正",
      is_high_risk: true,
      result: "success",
      error_message: null,
      created_at: "2026-06-02T10:00:00.000Z",
    });

    expect(entry).toEqual({
      id: "audit-1",
      actorName: "Ops Manager",
      actorRole: "ops_manager",
      action: "reopen",
      module: "settlement",
      objectType: "settlement_batch",
      objectId: "batch-1",
      objectName: "Batch 1",
      projectId: "project-1",
      streamerId: null,
      changedFields: ["status", "reopen_reason"],
      reason: "结算金额修正",
      isHighRisk: true,
      result: "success",
      errorMessage: null,
      createdAt: "2026-06-02T10:00:00.000Z",
    });
    expect(JSON.stringify(entry)).not.toContain("organization_id");
    expect(JSON.stringify(entry)).not.toContain("before_json");
    expect(JSON.stringify(entry)).not.toContain("after_json");
  });

  it("owners can list all organization audit entries and filter by high risk", async () => {
    const { client, calls } = createClient([]);

    await listAuditCenterEntries(client, owner, {
      highRiskOnly: true,
      limit: 25,
    });

    expect(calls).toContainEqual(["eq", ["organization_id", "org-1"]]);
    expect(calls).toContainEqual(["eq", ["is_high_risk", true]]);
  });

  it("finance only sees finance settlement audit modules", async () => {
    const { client, calls } = createClient([]);

    await listAuditCenterEntries(
      client,
      { ...owner, role: "finance" },
      { limit: 25 },
    );

    expect(calls).toContainEqual([
      "in",
      ["module", ["finance", "settlement", "audit", "auth"]],
    ]);
  });

  it("operator business is scoped to their own project audit entries", async () => {
    const { client, calls } = createClient([]);

    await listAuditCenterEntries(
      client,
      { ...owner, role: "operator_business" },
      { projectId: "project-1", limit: 25 },
    );

    expect(calls).toContainEqual(["eq", ["project_id", "project-1"]]);
  });
});
