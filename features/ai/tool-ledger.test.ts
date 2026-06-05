import { describe, expect, it, vi } from "vitest";

import { recordAiToolInvocation } from "./tool-ledger";

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

describe("recordAiToolInvocation", () => {
  it("writes read-only tool invocation details", async () => {
    const { client, inserts } = createClient();

    await recordAiToolInvocation({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      invocationId: "00000000-0000-4000-8000-000000000001",
      input: {
        toolName: "project_review_summary",
        inputSummary: { report: { projectName: "Demo" } },
        outputSummary: { recommendation: "continue_project" },
        scopes: ["mcn_staff"],
        readOnly: true,
        allowed: true,
        status: "succeeded",
        latencyMs: 4,
      },
    });

    expect(inserts.ai_tool_invocations).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        ai_invocation_id: "00000000-0000-4000-8000-000000000001",
        tool_name: "project_review_summary",
        read_only: true,
        allowed: true,
        status: "succeeded",
        latency_ms: 4,
      }),
    ]);
  });
});
