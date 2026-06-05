import { describe, expect, it, vi } from "vitest";

import { recordAiInvocation } from "./invocation-ledger";

function createClient() {
  const inserts: Record<string, Record<string, unknown>[]> = {};
  return {
    client: {
      from: vi.fn((table: string) => ({
        insert: vi.fn(async (payload: Record<string, unknown>) => {
          inserts[table] = [...(inserts[table] ?? []), payload];
          return { error: null };
        }),
      })),
    },
    inserts,
  };
}

describe("recordAiInvocation", () => {
  it("writes invocation, usage, and audit rows", async () => {
    const { client, inserts } = createClient();

    const invocationId = await recordAiInvocation({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      input: {
        id: "00000000-0000-4000-8000-000000000001",
        scene: "diagnosis",
        objectType: "live_report",
        objectId: "report-1",
        providerName: "deterministic",
        status: "succeeded",
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
        costCents: 1,
        latencyMs: 12,
      },
    });

    expect(invocationId).toBe("00000000-0000-4000-8000-000000000001");
    expect(inserts.ai_invocations).toEqual([
      expect.objectContaining({
        id: invocationId,
        organization_id: "org-1",
        scene: "diagnosis",
        object_type: "live_report",
        object_id: "report-1",
        status: "succeeded",
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
        cost_cents: 1,
      }),
    ]);
    expect(inserts.usage_events).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        metric: "ai",
        quantity: 5,
        source: "ai_runtime",
        object_type: "ai_invocation",
        object_id: invocationId,
      }),
    ]);
    expect(inserts.audit_logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organization_id: "org-1",
          module: "ai",
          object_type: "ai_invocation",
          object_id: invocationId,
        }),
      ]),
    );
  });
});
