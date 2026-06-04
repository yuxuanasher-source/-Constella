import { describe, expect, it, vi } from "vitest";

import { listRegisteredAiTools, runAiToolQuery } from "./ai-tool-layer";

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

describe("runAiToolQuery", () => {
  it("runs registered read-only tools and writes invocation, tool, usage, and audit rows", async () => {
    const { client, inserts } = createClient();

    const result = await runAiToolQuery({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      toolName: "project_review_summary",
      input: {
        report: {
          projectName: "Campaign Alpha",
          grossMarginCents: 500000,
          marginRateBps: 4167,
          shouldContinue: true,
        },
      },
    });

    expect(result).toMatchObject({
      toolName: "project_review_summary",
      mode: "deterministic",
      invocationId: expect.any(String),
      answer: expect.stringContaining("Campaign Alpha"),
    });
    expect(inserts.ai_invocations).toEqual([
      expect.objectContaining({
        id: result.invocationId,
        organization_id: "org-1",
        scene: "ai_tool_query",
        object_type: "ai_tool",
        object_id: "project_review_summary",
        status: "succeeded",
      }),
    ]);
    expect(inserts.ai_tool_invocations).toEqual([
      expect.objectContaining({
        ai_invocation_id: result.invocationId,
        tool_name: "project_review_summary",
        read_only: true,
        allowed: true,
        status: "succeeded",
      }),
    ]);
    expect(inserts.usage_events).toEqual([
      expect.objectContaining({
        metric: "ai",
        quantity: 2,
        source: "ai_runtime",
      }),
    ]);
    expect(inserts.audit_logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organization_id: "org-1",
          action: "create",
          module: "ai",
          object_type: "ai_query",
          changed_fields: ["tool_name"],
        }),
      ]),
    );
  });

  it("registers every AI tool as read-only with a public contract", () => {
    expect(listRegisteredAiTools()).toEqual([
      expect.objectContaining({
        name: "project_review_summary",
        readOnly: true,
        description: expect.any(String),
        inputSchema: expect.any(Object),
        scopes: expect.arrayContaining(["mcn_staff"]),
      }),
      expect.objectContaining({
        name: "streamer_diagnosis",
        readOnly: true,
        masking: expect.objectContaining({
          streamerForbiddenKeys: expect.arrayContaining(["grossMarginCents"]),
        }),
      }),
    ]);
  });

  it("rejects arbitrary or unregistered tools", async () => {
    const { client } = createClient();

    await expect(
      runAiToolQuery({
        client,
        actor: {
          userId: "user-ops",
          name: "Ops Manager",
          role: "ops_manager",
          organizationId: "org-1",
        },
        toolName: "sql.query",
        input: { sql: "select * from settlement_batches" },
      }),
    ).rejects.toThrow("AI tool is not registered");
  });

  it("filters streamer diagnosis DTOs so streamer AI cannot see MCN finance", async () => {
    const { client } = createClient();

    const result = await runAiToolQuery({
      client,
      actor: {
        userId: "user-streamer",
        name: "Streamer Ava",
        role: "streamer",
        organizationId: "org-1",
      },
      toolName: "streamer_diagnosis",
      input: {
        task: {
          title: "Evening peak sprint",
          game: "moba",
          requiredDurationMinutes: 120,
          internalRiskNotes: "Low margin, internal only",
        },
        report: {
          settlementDuration: 80,
          totalViews: 300,
          evidenceLevel: "yellow",
          receivableCents: 100000,
          grossMarginCents: 50000,
          supplierCostCents: 20000,
          costCents: 30000,
        },
        feedback: ["slow opening", "weak interaction"],
      },
    });

    expect(result).toMatchObject({
      toolName: "streamer_diagnosis",
      mode: "deterministic",
      invocationId: expect.any(String),
      output: {
        diagnosisType: "traffic_drop",
        followUpQuestions: expect.any(Array),
        scriptSuggestions: expect.any(Array),
      },
    });
    const serialized = JSON.stringify(result.output);
    expect(serialized).not.toContain("receivableCents");
    expect(serialized).not.toContain("grossMarginCents");
    expect(serialized).not.toContain("supplierCostCents");
    expect(serialized).not.toContain("costCents");
    expect(serialized).not.toContain("internalRiskNotes");
  });
});
