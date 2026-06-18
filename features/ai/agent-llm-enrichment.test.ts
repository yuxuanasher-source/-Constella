import { describe, expect, it, vi } from "vitest";

import { enrichAgentOutputWithLlm } from "./agent-llm-enrichment";
import type { AgentOutput, AiProvider } from "./contracts";

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

const actor = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

const ledgerClient = {
  from: () => ({ insert: async () => ({ error: null }) }),
} as never;

const baseOutput: AgentOutput = {
  facts: [
    {
      statement: "Margin rate is 1800 bps",
      sourceTool: "business_analysis",
      sourceId: "inv-1:marginRateBps",
    },
  ],
  findings: [
    {
      summary: "Margin needs attention before continuing the project",
      evidence: [
        { sourceTool: "business_analysis", sourceId: "inv-1:marginRateBps" },
      ],
    },
  ],
  caveats: [],
  recommendations: [
    { proposal: "Review the pricing structure", requiresHumanApproval: true },
  ],
};

describe("enrichAgentOutputWithLlm", () => {
  it("rewrites the narrative with the model while keeping facts, evidence and approval deterministic", async () => {
    const runGateway = vi.fn(async () => ({
      status: "succeeded" as const,
      providerName: "hunyuan" as const,
      fallbackUsed: false,
      structuredOutput: {
        findings: [{ summary: "毛利率偏低,盈利能力承压" }],
        caveats: [{ summary: "外部供给成本波动未独立核验" }],
        recommendations: [
          {
            proposal: "复盘定价结构与供给成本",
            expectedImpact: "改善毛利空间",
          },
        ],
      },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 5,
      costCents: 1,
    }));
    const recordInvocation = vi.fn(async () => "invocation-1");

    const result = await enrichAgentOutputWithLlm({
      output: baseOutput,
      scene: "business_analysis",
      role: "你是经营分析助手。",
      client: ledgerClient,
      actor,
      providers: [fakeProvider("hunyuan")],
      runGateway,
      recordInvocation,
    });

    expect(result.facts).toEqual(baseOutput.facts);
    expect(result.findings[0].summary).toBe("毛利率偏低,盈利能力承压");
    expect(result.findings[0].evidence).toEqual([
      { sourceTool: "business_analysis", sourceId: "inv-1:marginRateBps" },
    ]);
    expect(result.caveats[0]).toMatchObject({
      summary: "外部供给成本波动未独立核验",
      unverifiedExternalFactor: true,
    });
    expect(result.recommendations[0]).toMatchObject({
      proposal: "复盘定价结构与供给成本",
      expectedImpact: "改善毛利空间",
      requiresHumanApproval: true,
    });
    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          scene: "business_analysis",
          providerName: "hunyuan",
        }),
      }),
    );
  });

  it("returns the deterministic output unchanged when no real provider is configured", async () => {
    const runGateway = vi.fn();

    const result = await enrichAgentOutputWithLlm({
      output: baseOutput,
      scene: "business_analysis",
      role: "你是经营分析助手。",
      client: ledgerClient,
      actor,
      providers: [],
      runGateway,
    });

    expect(result).toBe(baseOutput);
    expect(runGateway).not.toHaveBeenCalled();
  });

  it("falls back to deterministic output when the model breaks the no-number guardrail", async () => {
    const runGateway = vi.fn(async () => ({
      status: "succeeded" as const,
      providerName: "hunyuan" as const,
      fallbackUsed: false,
      structuredOutput: {
        findings: [{ summary: "毛利率较上月下滑30%" }],
        recommendations: [{ proposal: "复盘成本" }],
      },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      latencyMs: 1,
      costCents: 1,
    }));

    const result = await enrichAgentOutputWithLlm({
      output: baseOutput,
      scene: "business_analysis",
      role: "你是经营分析助手。",
      client: ledgerClient,
      actor,
      providers: [fakeProvider("hunyuan")],
      runGateway,
      recordInvocation: vi.fn(async () => "invocation-1"),
    });

    expect(result).toBe(baseOutput);
  });
});
