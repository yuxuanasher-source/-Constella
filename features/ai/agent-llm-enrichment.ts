import { z } from "zod";

import { validateAgentOutput } from "./agent-output-contract";
import type {
  AgentOutput,
  AiActor,
  AiGatewayResult,
  AiInvocationStatus,
  AiMessage,
  AiProvider,
  AiProviderName,
} from "./contracts";
import { recordAiInvocation } from "./invocation-ledger";
import { runAiGateway } from "./llm-gateway";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "./provider-registry";

type LedgerClient = Parameters<typeof recordAiInvocation>[0]["client"];

const PROMPT_VERSION = 1;

const enrichmentSchema = z.object({
  findings: z.array(z.object({ summary: z.string().trim().min(1) })).min(1),
  caveats: z.array(z.object({ summary: z.string().trim().min(1) })).optional(),
  recommendations: z
    .array(
      z.object({
        proposal: z.string().trim().min(1),
        expectedImpact: z.string().trim().min(1).optional(),
      }),
    )
    .min(1),
});

function buildSystemPrompt(role: string): string {
  return [
    role,
    "严格规则:",
    "1. 只能依据下方提供的事实,不得编造任何数据、平台信息或外部因素。",
    "2. findings(结论)、caveats(风险提示)、recommendations(建议)的文字中禁止出现任何阿拉伯数字(0-9);需要表达数值时用定性描述,例如「偏低」「明显高于均值」「显著下滑」。",
    "3. 所有建议都必须经人工确认后才能执行,不要给出可直接自动执行的指令。",
    "4. 使用简洁、专业、可执行的中文。",
    '5. 只返回 JSON,结构为:{"findings":[{"summary":"..."}],"caveats":[{"summary":"..."}],"recommendations":[{"proposal":"...","expectedImpact":"..."}]}。',
  ].join("\n");
}

// Rewrites an agent's deterministic findings/caveats/recommendations as a
// grounded Chinese narrative using the configured model, while keeping the
// facts, evidence links and human-approval flags deterministic. Returns the
// original output unchanged when no real provider is configured or when the
// model output fails the guardrails — so a missing/failing model never breaks
// the caller.
export async function enrichAgentOutputWithLlm({
  output,
  scene,
  role,
  contextLines = [],
  client,
  actor,
  providers,
  primaryProvider,
  runGateway = runAiGateway,
  recordInvocation = recordAiInvocation,
}: {
  output: AgentOutput;
  scene: string;
  role: string;
  contextLines?: string[];
  client: LedgerClient;
  actor: AiActor;
  providers?: AiProvider[];
  primaryProvider?: AiProviderName;
  runGateway?: typeof runAiGateway;
  recordInvocation?: typeof recordAiInvocation;
}): Promise<AgentOutput> {
  const resolvedProviders = providers ?? createConfiguredAiProviders();
  const hasRealProvider = resolvedProviders.some(
    (provider) => provider.name === "openai" || provider.name === "hunyuan",
  );
  if (!hasRealProvider || output.facts.length === 0) {
    return output;
  }

  const routing = resolveAiProviderRouting();
  const resolvedPrimary = primaryProvider ?? routing.primaryProvider;

  // Reuse the deterministic evidence links so every finding stays grounded in
  // an existing fact regardless of how many findings the model returns.
  const evidencePool = output.findings.flatMap((finding) => finding.evidence);
  const evidence =
    evidencePool.length > 0
      ? evidencePool
      : [
          {
            sourceTool: output.facts[0].sourceTool,
            sourceId: output.facts[0].sourceId,
          },
        ];

  const messages: AiMessage[] = [
    { role: "system", content: buildSystemPrompt(role) },
    {
      role: "user",
      content: [
        ...contextLines,
        "以下是事实数据:",
        ...output.facts.map((fact) => `- ${fact.statement}`),
        "",
        "请基于以上事实输出结论(findings)、风险提示(caveats)与改进建议(recommendations)。",
      ].join("\n"),
    },
  ];

  let gatewayResult: AiGatewayResult;
  try {
    gatewayResult = await runGateway({
      providers: resolvedProviders,
      primaryProvider: resolvedPrimary,
      request: {
        kind: "structured",
        promptKey: scene,
        promptVersion: PROMPT_VERSION,
        messages,
        responseSchema: enrichmentSchema,
      },
    });
  } catch {
    return output;
  }

  await recordInvocation({
    client,
    actor,
    input: {
      scene,
      providerName: gatewayResult.providerName,
      primaryProvider: resolvedPrimary,
      shadowProvider: routing.shadowProvider,
      status: gatewayResult.status as AiInvocationStatus,
      promptKey: scene,
      promptVersion: PROMPT_VERSION,
      usage: gatewayResult.usage,
      costCents: gatewayResult.costCents,
      latencyMs: gatewayResult.latencyMs,
      degradedReason: gatewayResult.degradedReason,
      errorSummary: gatewayResult.errorSummary,
    },
  }).catch(() => {});

  if (
    gatewayResult.status !== "succeeded" ||
    !gatewayResult.providerName ||
    gatewayResult.providerName === "deterministic"
  ) {
    return output;
  }

  const parsed = enrichmentSchema.safeParse(gatewayResult.structuredOutput);
  if (!parsed.success) {
    return output;
  }

  const enriched: AgentOutput = {
    facts: output.facts,
    findings: parsed.data.findings.map((finding) => ({
      summary: finding.summary,
      evidence,
    })),
    caveats: (parsed.data.caveats ?? []).map((caveat) => ({
      summary: caveat.summary,
      unverifiedExternalFactor: true,
    })),
    recommendations: parsed.data.recommendations.map((recommendation) => ({
      proposal: recommendation.proposal,
      ...(recommendation.expectedImpact
        ? { expectedImpact: recommendation.expectedImpact }
        : {}),
      requiresHumanApproval: true as const,
    })),
  };

  return validateAgentOutput(enriched).valid ? enriched : output;
}
