import { describe, expect, it, vi } from "vitest";

import { runAiToolQuery } from "./ai-tool-layer";

function createClient() {
  const auditInserts: Record<string, unknown>[] = [];
  return {
    client: {
      from: vi.fn(() => ({
        insert: vi.fn(async (payload: Record<string, unknown>) => {
          auditInserts.push(payload);
          return { error: null };
        }),
      })),
    },
    auditInserts,
  };
}

describe("runAiToolQuery", () => {
  it("runs only registered read-only tools and writes audit", async () => {
    const { client, auditInserts } = createClient();

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
          projectName: "王者荣耀春节档",
          grossMarginCents: 500000,
          marginRateBps: 4167,
          shouldContinue: true,
        },
      },
    });

    expect(result).toMatchObject({
      toolName: "project_review_summary",
      mode: "placeholder",
      answer: expect.stringContaining("王者荣耀春节档"),
    });
    expect(auditInserts).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        action: "create",
        module: "ai",
        object_type: "ai_query",
        changed_fields: ["tool_name"],
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
        name: "主播 Ava",
        role: "streamer",
        organizationId: "org-1",
      },
      toolName: "streamer_diagnosis",
      input: {
        task: {
          title: "晚高峰冲榜",
          game: "moba",
          requiredDurationMinutes: 120,
          internalRiskNotes: "低毛利，不可外露",
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
        feedback: ["开场节奏慢", "互动断层"],
      },
    });

    expect(result).toMatchObject({
      toolName: "streamer_diagnosis",
      output: {
        diagnosisType: "traffic_drop",
        followUpQuestions: expect.arrayContaining([
          "本场开播前 10 分钟是否完成预热视频或粉丝群预热？",
        ]),
        scriptSuggestions: expect.arrayContaining([
          "把开场 3 分钟改成明确目标 + 福利节点，先建立停留理由。",
        ]),
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
