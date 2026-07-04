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

function succeededGateway(structuredOutput: unknown) {
  return vi.fn(async () => ({
    status: "succeeded" as const,
    providerName: "hunyuan" as const,
    fallbackUsed: false,
    structuredOutput,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    latencyMs: 5,
    costCents: 1,
  }));
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
    {
      statement: "Receivable is 90000 cents",
      sourceTool: "business_analysis",
      sourceId: "inv-1:receivableCents",
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
  it("rewrites the narrative and maps each finding's factRefs to the referenced fact sources", async () => {
    const runGateway = succeededGateway({
      findings: [
        { summary: "毛利率偏低,盈利能力承压", factRefs: [0] },
        { summary: "应收规模尚可,回款需跟进", factRefs: [1] },
      ],
      caveats: [{ summary: "外部供给成本波动未独立核验" }],
      recommendations: [
        {
          proposal: "复盘定价结构与供给成本",
          expectedImpact: "改善毛利空间",
          factRefs: [0],
        },
      ],
    });
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

    expect(result.narrative).toEqual({
      source: "llm",
      providerName: "hunyuan",
    });
    expect(result.output.facts).toEqual(baseOutput.facts);
    expect(result.output.findings).toEqual([
      {
        summary: "毛利率偏低,盈利能力承压",
        evidence: [
          { sourceTool: "business_analysis", sourceId: "inv-1:marginRateBps" },
        ],
      },
      {
        summary: "应收规模尚可,回款需跟进",
        evidence: [
          {
            sourceTool: "business_analysis",
            sourceId: "inv-1:receivableCents",
          },
        ],
      },
    ]);
    expect(result.output.caveats[0]).toMatchObject({
      summary: "外部供给成本波动未独立核验",
      unverifiedExternalFactor: true,
    });
    expect(result.output.recommendations[0]).toMatchObject({
      proposal: "复盘定价结构与供给成本",
      expectedImpact: "改善毛利空间",
      requiresHumanApproval: true,
    });

    const gatewayArgs = (runGateway.mock.calls as unknown[][])[0]?.[0] as {
      request: { promptVersion: number; messages: { content: string }[] };
    };
    expect(gatewayArgs.request.promptVersion).toBe(2);
    expect(gatewayArgs.request.messages[1].content).toContain(
      "[0] Margin rate is 1800 bps",
    );
    expect(gatewayArgs.request.messages[1].content).toContain(
      "[1] Receivable is 90000 cents",
    );

    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          scene: "business_analysis",
          providerName: "hunyuan",
          promptVersion: 2,
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

    expect(result.output).toBe(baseOutput);
    expect(result.narrative).toEqual({
      source: "deterministic",
      degradedReason: "provider_unconfigured",
    });
    expect(runGateway).not.toHaveBeenCalled();
  });

  it("drops a finding whose factRefs are all invalid while keeping valid findings", async () => {
    const runGateway = succeededGateway({
      findings: [
        { summary: "毛利率偏低,盈利能力承压", factRefs: [0] },
        { summary: "凭空引用的结论", factRefs: [9] },
      ],
      recommendations: [{ proposal: "复盘定价结构", factRefs: [1] }],
    });

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

    expect(result.narrative.source).toBe("llm");
    expect(result.output.findings).toEqual([
      {
        summary: "毛利率偏低,盈利能力承压",
        evidence: [
          { sourceTool: "business_analysis", sourceId: "inv-1:marginRateBps" },
        ],
      },
    ]);
  });

  it("falls back to deterministic output when every finding cites invalid factRefs", async () => {
    const runGateway = succeededGateway({
      findings: [{ summary: "凭空引用的结论", factRefs: [9] }],
      recommendations: [{ proposal: "复盘定价结构" }],
    });

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

    expect(result.output).toBe(baseOutput);
    expect(result.narrative).toEqual({
      source: "deterministic",
      degradedReason: "all_findings_dropped",
    });
  });

  it("falls back to deterministic output when the model omits factRefs", async () => {
    const runGateway = succeededGateway({
      findings: [{ summary: "毛利率偏低,盈利能力承压" }],
      recommendations: [{ proposal: "复盘定价结构" }],
    });

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

    expect(result.output).toBe(baseOutput);
    expect(result.narrative).toEqual({
      source: "deterministic",
      degradedReason: "schema_validation_failed",
    });
  });

  it("drops recommendations citing only invalid factRefs and falls back when none survive", async () => {
    const runGateway = succeededGateway({
      findings: [{ summary: "毛利率偏低,盈利能力承压", factRefs: [0] }],
      recommendations: [{ proposal: "凭空引用的建议", factRefs: [9] }],
    });

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

    expect(result.output).toBe(baseOutput);
    expect(result.narrative).toEqual({
      source: "deterministic",
      degradedReason: "all_recommendations_dropped",
    });
  });

  it("keeps findings that restate numbers from their cited facts and drops unsourced numeric claims", async () => {
    const runGateway = succeededGateway({
      findings: [
        // 1800 出现在被引用的事实里 → 合法复述。
        { summary: "毛利率 1800 bps 偏低", factRefs: [0] },
        // 30 没有任何事实来源 → 该条被丢弃。
        { summary: "毛利率较上月下滑30%", factRefs: [0] },
      ],
      recommendations: [{ proposal: "复盘定价结构", factRefs: [0] }],
    });

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

    expect(result.narrative.source).toBe("llm");
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0].summary).toBe("毛利率 1800 bps 偏低");
  });

  it("falls back to deterministic output when every narrative item breaks the number guardrail", async () => {
    const runGateway = succeededGateway({
      findings: [{ summary: "毛利率较上月下滑30%", factRefs: [0] }],
      recommendations: [{ proposal: "复盘成本" }],
    });

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

    expect(result.output).toBe(baseOutput);
    expect(result.narrative).toEqual({
      source: "deterministic",
      degradedReason: "all_findings_dropped",
    });
  });

  it("passes ledgerExtras through to the invocation ledger", async () => {
    const runGateway = succeededGateway({
      findings: [{ summary: "毛利率偏低,盈利能力承压", factRefs: [0] }],
      recommendations: [{ proposal: "复盘定价结构", factRefs: [0] }],
    });
    const recordInvocation = vi.fn(async () => "invocation-1");

    await enrichAgentOutputWithLlm({
      output: baseOutput,
      scene: "streamer_diagnosis",
      role: "你是诊断助手。",
      client: ledgerClient,
      actor,
      providers: [fakeProvider("hunyuan")],
      runGateway,
      recordInvocation,
      ledgerExtras: {
        objectType: "streamer",
        metadata: { diagnosisType: "traffic_drop" },
      },
    });

    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          scene: "streamer_diagnosis",
          objectType: "streamer",
          metadata: { diagnosisType: "traffic_drop" },
        }),
      }),
    );
  });
});
