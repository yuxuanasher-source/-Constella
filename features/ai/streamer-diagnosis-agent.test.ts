import { describe, expect, it, vi } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import { runStreamerDiagnosisAgent } from "./streamer-diagnosis-agent";
import type { AgentOutput } from "./contracts";

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
