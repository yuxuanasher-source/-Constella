import { describe, expect, it, vi } from "vitest";

import { listRegisteredAiTools, runAiToolQuery } from "./ai-tool-layer";
import type { AiProvider, AiProviderResult } from "./contracts";

function fakeLlmProvider(
  structuredOutput: unknown,
  overrides: Partial<AiProviderResult> = {},
): AiProvider {
  const result: AiProviderResult = {
    status: "succeeded",
    structuredOutput,
    usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
    latencyMs: 12,
    costCents: 5,
    ...overrides,
  };
  return {
    name: "deepseek",
    capabilities: ["text", "structured", "tools", "shadow"],
    runText: vi.fn(async () => result),
    runStructured: vi.fn(async () => result),
    runWithTools: vi.fn(async () => result),
    estimateCost: () => ({ costCents: 0 }),
  };
}

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

  it("upgrades to llm mode when a gateway provider succeeds and records the real provider", async () => {
    const { client, inserts } = createClient();
    const provider = fakeLlmProvider({
      diagnosisType: "content_rhythm",
      answer: "开场节奏偏慢，建议前 3 分钟设福利节点。",
      followUpQuestions: ["开播前是否预热？"],
      scriptSuggestions: ["把开场改成目标 + 福利。"],
    });

    const result = await runAiToolQuery({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      toolName: "streamer_diagnosis",
      input: { feedback: ["弱互动"] },
      gateway: { providers: [provider], primaryProvider: "deepseek" },
    });

    expect(result).toMatchObject({
      toolName: "streamer_diagnosis",
      mode: "llm",
      output: {
        diagnosisType: "content_rhythm",
        scriptSuggestions: ["把开场改成目标 + 福利。"],
      },
    });
    expect(result.answer).toContain("福利节点");
    expect(provider.runStructured).toHaveBeenCalledTimes(1);
    expect(inserts.ai_invocations).toEqual([
      expect.objectContaining({
        provider_name: "deepseek",
        primary_provider: "deepseek",
        prompt_key: "streamer_diagnosis",
        prompt_version: 1,
        total_tokens: 200,
        cost_cents: 5,
        status: "succeeded",
      }),
    ]);
  });

  it("falls back to deterministic output when the gateway provider is unavailable", async () => {
    const { client, inserts } = createClient();
    const provider = fakeLlmProvider(undefined, {
      status: "degraded",
      degradedReason: "provider_unconfigured",
      structuredOutput: undefined,
    });

    const result = await runAiToolQuery({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      toolName: "streamer_diagnosis",
      input: { feedback: ["互动断层"] },
      gateway: { providers: [provider], primaryProvider: "deepseek" },
    });

    expect(result.mode).toBe("deterministic");
    expect(result.output.scriptSuggestions).toEqual(expect.any(Array));
    expect(inserts.ai_invocations).toEqual([
      expect.objectContaining({
        provider_name: "deterministic",
        status: "succeeded",
        degraded_reason: expect.any(String),
      }),
    ]);
  });

  it("strips forbidden fields the LLM echoes back for streamer actors", async () => {
    const { client } = createClient();
    const provider = fakeLlmProvider({
      diagnosisType: "traffic_drop",
      answer: "流量下滑，关注开场留存。",
      followUpQuestions: ["前 15 分钟是否有福利？"],
      scriptSuggestions: ["前 3 分钟建立停留理由。"],
      grossMarginCents: 999,
      receivableCents: 888,
    });

    const result = await runAiToolQuery({
      client,
      actor: {
        userId: "user-streamer",
        name: "Streamer Ava",
        role: "streamer",
        organizationId: "org-1",
      },
      toolName: "streamer_diagnosis",
      input: { feedback: ["弱互动"] },
      gateway: { providers: [provider], primaryProvider: "deepseek" },
    });

    expect(result.mode).toBe("llm");
    const serialized = JSON.stringify(result.output);
    expect(serialized).not.toContain("grossMarginCents");
    expect(serialized).not.toContain("receivableCents");
  });
});
