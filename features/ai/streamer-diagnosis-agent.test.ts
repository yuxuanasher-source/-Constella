import { describe, expect, it, vi } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import {
  gatherStreamerDiagnosisContext,
  runStreamerDiagnosisAgent,
} from "./streamer-diagnosis-agent";
import type { AgentOutput, AiProvider } from "./contracts";

function queryResult(rows: unknown[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: async () => ({ data: rows, error: null }),
  };
  return chain;
}

function fakeProvider(name: AiProvider["name"]): AiProvider {
  const ok = {
    status: "succeeded" as const,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    latencyMs: 0,
    costCents: 0,
  };
  return {
    name,
    capabilities: ["text", "structured"],
    runText: async () => ok,
    runStructured: async () => ok,
    runWithTools: async () => ({ ...ok, status: "degraded" as const }),
    estimateCost: () => ({ costCents: 0 }),
  };
}

const trafficDropInput = {
  report: {
    settlementDuration: 80,
    totalViews: 300,
    evidenceLevel: "yellow",
  },
  feedback: ["weak interaction"],
};

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

const streamerActor = {
  userId: "user-streamer",
  name: "Streamer Ava",
  role: "streamer" as const,
  organizationId: "org-1",
};

describe("runStreamerDiagnosisAgent", () => {
  it("builds grounded traffic-drop output without leaking streamer-forbidden fields", async () => {
    const { client } = createClient();

    const result = await runStreamerDiagnosisAgent({
      client,
      actor: streamerActor,
      input: {
        report: {
          settlementDuration: 80,
          totalViews: 300,
          evidenceLevel: "yellow",
          grossMarginCents: 50000,
          supplierCostCents: 20000,
        },
        feedback: ["weak interaction"],
      },
    });

    expect(result.result).toMatchObject({
      toolName: "streamer_diagnosis",
      invocationId: expect.any(String),
      output: {
        diagnosisType: "traffic_drop",
      },
    });
    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: "Total views are 300",
          sourceTool: "streamer_diagnosis",
          sourceId: `${result.result.invocationId}:report.totalViews`,
        }),
        expect.objectContaining({
          statement: "Settlement duration is 80 minutes",
          sourceId: `${result.result.invocationId}:report.settlementDuration`,
        }),
        expect.objectContaining({
          statement: "Diagnosis type is traffic_drop",
          sourceId: `${result.result.invocationId}:output.diagnosisType`,
        }),
      ]),
    );
    expect(result.agentOutput.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary:
            "Interaction pattern needs attention before the next live session",
          evidence: [
            {
              sourceTool: "streamer_diagnosis",
              sourceId: `${result.result.invocationId}:report.totalViews`,
            },
            {
              sourceTool: "streamer_diagnosis",
              sourceId: `${result.result.invocationId}:output.diagnosisType`,
            },
          ],
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
    expect(JSON.stringify(result.agentOutput)).not.toContain(
      "grossMarginCents",
    );
    expect(JSON.stringify(result.agentOutput)).not.toContain(
      "supplierCostCents",
    );
  });

  it("builds content-rhythm output with human-approved recommendations only", async () => {
    const { client } = createClient();

    const result = await runStreamerDiagnosisAgent({
      client,
      actor: streamerActor,
      input: {
        report: {
          settlementDuration: 120,
          totalViews: 1500,
          evidenceLevel: "green",
        },
        feedback: ["opening pace felt slow"],
      },
    });

    expect(result.validation.valid).toBe(true);
    expect(result.agentOutput.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary:
            "Content rhythm needs attention before the next live session",
        }),
      ]),
    );
    expect(result.agentOutput.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal:
            "Refine opening hook and interaction rhythm before the next session",
          requiresHumanApproval: true,
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("uses the model narrative when a real provider is configured, keeping evidence and approval deterministic", async () => {
    const { client } = createClient();
    const runGateway = vi.fn(async () => ({
      status: "succeeded" as const,
      providerName: "hunyuan" as const,
      fallbackUsed: false,
      structuredOutput: {
        findings: [{ summary: "开场互动偏弱,留存信号承压" }],
        caveats: [{ summary: "平台流量波动未独立核验" }],
        recommendations: [
          {
            proposal: "优化开场钩子与互动节奏",
            expectedImpact: "提升留存信号",
          },
        ],
      },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 5,
      costCents: 1,
    }));
    const recordInvocation = vi.fn(async () => "invocation-llm");

    const result = await runStreamerDiagnosisAgent({
      client,
      actor: streamerActor,
      input: trafficDropInput,
      providers: [fakeProvider("hunyuan")],
      primaryProvider: "hunyuan",
      runGateway,
      recordInvocation,
    });

    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.agentOutput.findings[0].summary).toBe(
      "开场互动偏弱,留存信号承压",
    );
    expect(result.agentOutput.findings[0].evidence).toEqual([
      {
        sourceTool: "streamer_diagnosis",
        sourceId: `${result.result.invocationId}:report.totalViews`,
      },
      {
        sourceTool: "streamer_diagnosis",
        sourceId: `${result.result.invocationId}:output.diagnosisType`,
      },
    ]);
    expect(result.agentOutput.caveats[0]).toMatchObject({
      summary: "平台流量波动未独立核验",
      unverifiedExternalFactor: true,
    });
    expect(result.agentOutput.recommendations[0]).toMatchObject({
      proposal: "优化开场钩子与互动节奏",
      expectedImpact: "提升留存信号",
      requiresHumanApproval: true,
    });
    expect(runGateway).toHaveBeenCalledOnce();
    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          scene: "streamer_diagnosis",
          providerName: "hunyuan",
          status: "succeeded",
        }),
      }),
    );
  });

  it("falls back to deterministic output when the model narrative breaks the no-number guardrail", async () => {
    const { client } = createClient();
    const runGateway = vi.fn(async () => ({
      status: "succeeded" as const,
      providerName: "hunyuan" as const,
      fallbackUsed: false,
      structuredOutput: {
        findings: [{ summary: "场观较上场下滑约30%" }],
        recommendations: [{ proposal: "复盘话术结构" }],
      },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 5,
      costCents: 1,
    }));

    const result = await runStreamerDiagnosisAgent({
      client,
      actor: streamerActor,
      input: trafficDropInput,
      providers: [fakeProvider("hunyuan")],
      runGateway,
      recordInvocation: vi.fn(async () => "invocation-llm"),
    });

    expect(result.validation.valid).toBe(true);
    expect(result.agentOutput.findings[0].summary).toBe(
      "Interaction pattern needs attention before the next live session",
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });
});

describe("gatherStreamerDiagnosisContext", () => {
  it("pulls the streamer's latest report metrics scoped to their own data", async () => {
    const client = {
      from: vi.fn((table: string) => {
        if (table === "streamers") {
          return queryResult([{ id: "streamer-1" }]);
        }
        if (table === "live_reports") {
          return queryResult([
            {
              viewers: 2488,
              settlement_duration: 180,
              evidence_level: "green",
              risk_flags: ["duration_divergence"],
            },
          ]);
        }
        return queryResult([]);
      }),
    };

    const context = await gatherStreamerDiagnosisContext({
      client: client as never,
      actor: streamerActor,
    });

    expect(context.report).toEqual({
      totalViews: 2488,
      settlementDuration: 180,
      evidenceLevel: "green",
    });
    expect(context.feedback).toEqual(["duration_divergence"]);
  });

  it("returns empty context when the user is not a streamer", async () => {
    const client = {
      from: vi.fn(() => queryResult([])),
    };

    const context = await gatherStreamerDiagnosisContext({
      client: client as never,
      actor: streamerActor,
    });

    expect(context).toEqual({});
  });
});

function expectNoNumbersOutsideFacts(output: AgentOutput): void {
  expect(validateAgentOutput(output)).toEqual({ valid: true, errors: [] });
  const nonFactText = [
    ...output.findings.map((finding) => finding.summary),
    ...output.caveats.map((caveat) => caveat.summary),
    ...output.recommendations.flatMap((recommendation) => [
      recommendation.proposal,
      recommendation.expectedImpact ?? "",
    ]),
  ].join(" ");

  expect(nonFactText).not.toMatch(/\d/);
}
