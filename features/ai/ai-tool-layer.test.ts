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
    // 确定性工具没有真实 token 消耗:不再伪造 usage 写入用量表,
    // 调用记录仍完整落在 ai_invocations 与审计日志。
    expect(inserts.usage_events).toBeUndefined();
    expect(inserts.ai_invocations[0]).toMatchObject({
      total_tokens: 0,
      metadata: expect.objectContaining({ mode: "deterministic" }),
    });
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

  it("registers every AI tool as read-only L1 with a public contract", () => {
    const tools = listRegisteredAiTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "business_copilot_answer",
        "compute_deviation",
        "kb_search",
        "match_blacklist",
        "predict_evidence_color",
        "project_review_summary",
        "query_streamer_profile",
        "streamer_project_review",
        "streamer_diagnosis",
        "xingyao_org_diagnosis",
      ].sort(),
    );
    for (const tool of tools) {
      // 工具表里只允许只读 L1 工具；L2/L3/L4 不在此注册（L4 注册即抛错）。
      expect(tool.readOnly).toBe(true);
      expect(tool.tier).toBe("L1_PERCEIVE");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.inputSchema).toBe("object");
      expect(Array.isArray(tool.scopes)).toBe(true);
    }
    const diagnosis = tools.find((tool) => tool.name === "streamer_diagnosis");
    expect(diagnosis?.masking.streamerForbiddenKeys).toContain("grossMarginCents");
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

  it("registers the business copilot as a read-only MCN staff tool", () => {
    expect(listRegisteredAiTools()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "business_copilot_answer",
          readOnly: true,
          scopes: expect.arrayContaining(["mcn_staff"]),
          inputSchema: expect.objectContaining({
            type: "object",
            required: ["question", "dashboard"],
          }),
        }),
      ]),
    );
  });

  it("runs business copilot through the audited AI tool path", async () => {
    const { client, inserts } = createClient();

    const result = await runAiToolQuery({
      client,
      actor: {
        userId: "user-owner",
        name: "Owner",
        role: "owner",
        organizationId: "org-1",
      },
      toolName: "business_copilot_answer",
      input: {
        question: "这个月经营健康吗",
        dashboard: {
          profile: {
            role: "owner",
            title: "经营总览看板",
            subtitle: "关注收入、毛利、履约和高风险动作",
            scopeLabel: "全组织",
          },
          kpis: [
            { key: "grossMarginRate", label: "毛利率", value: 30, unit: "%" },
          ],
          queue: [],
          risks: [],
          drilldowns: [],
          generatedAt: "2026-06-18T04:00:00.000Z",
        },
      },
    });

    expect(result).toMatchObject({
      toolName: "business_copilot_answer",
      mode: "deterministic",
      output: {
        intent: "executive_health",
        facts: expect.arrayContaining([
          expect.objectContaining({ sourceId: "kpi:grossMarginRate" }),
        ]),
      },
    });
    expect(inserts.ai_invocations).toEqual([
      expect.objectContaining({
        object_id: "business_copilot_answer",
        status: "succeeded",
      }),
    ]);
    expect(inserts.ai_tool_invocations).toEqual([
      expect.objectContaining({
        tool_name: "business_copilot_answer",
        read_only: true,
        allowed: true,
        status: "succeeded",
      }),
    ]);
    expect(inserts.audit_logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: "ai",
          object_type: "ai_query",
          object_name: "business_copilot_answer",
        }),
      ]),
    );
  });

  it("runs streamer project review through the audited read-only AI tool path", async () => {
    const { client, inserts } = createClient();

    const result = await runAiToolQuery({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      toolName: "streamer_project_review",
      input: {
        profileInput: {
          streamer: { id: "streamer-1", displayName: "阿星" },
          project: { id: "project-1", name: "传奇复古", productType: "legend" },
          tasks: [
            {
              id: "task-1",
              plannedStartAt: "2026-07-01T10:00:00.000Z",
              plannedEndAt: "2026-07-01T12:00:00.000Z",
              status: "completed",
              systemDuration: 120,
            },
            {
              id: "task-2",
              plannedStartAt: "2026-07-02T10:00:00.000Z",
              plannedEndAt: "2026-07-02T12:00:00.000Z",
              status: "completed",
              systemDuration: 110,
            },
          ],
          reports: [
            {
              id: "report-1",
              taskId: "task-1",
              status: "approved",
              settlementDuration: 120,
              viewers: 2400,
              pcu: 320,
              acu: 90,
              evidenceLevel: "green",
              riskFlags: [],
            },
            {
              id: "report-2",
              taskId: "task-2",
              status: "pending_review",
              settlementDuration: 110,
              viewers: 1800,
              pcu: 260,
              acu: 70,
              evidenceLevel: "yellow",
              riskFlags: ["duration_divergence"],
            },
          ],
          recordings: [
            {
              id: "rec-1",
              status: "approved",
              adopted: true,
              rejectionReasons: [],
              durationSeconds: 1800,
            },
          ],
        },
      },
    });

    expect(result).toMatchObject({
      toolName: "streamer_project_review",
      mode: "deterministic",
      output: {
        profile: {
          participation: {
            effectiveLiveDays: 2,
          },
        },
        agentOutput: {
          reviewDraft: {
            summary: expect.stringContaining("阿星在传奇复古项目已形成 2 个有效直播日"),
          },
          facts: expect.arrayContaining([
            expect.objectContaining({
              sourceTool: "streamer_project_profile",
            }),
          ]),
        },
      },
    });
    expect(inserts.ai_tool_invocations).toEqual([
      expect.objectContaining({
        tool_name: "streamer_project_review",
        read_only: true,
        allowed: true,
        status: "succeeded",
      }),
    ]);
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
