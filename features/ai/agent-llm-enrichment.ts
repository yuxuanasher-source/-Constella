import {
  collectNumberTokens,
  hasUnsourcedNumber,
  validateAgentOutput,
} from "./agent-output-contract";
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
  ENRICHMENT_PROMPT_VERSION,
  buildAgentSystemPrompt,
  buildEnrichmentUserPrompt,
  enrichmentSchema,
} from "./prompt-templates";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "./provider-registry";

type LedgerClient = Parameters<typeof recordAiInvocation>[0]["client"];

type Evidence = AgentOutput["findings"][number]["evidence"][number];

// 降级可见性(方案 WP4):调用方能区分"模型叙事"与"确定性兜底",
// 路由把它随响应返回,UI 可以据此打标。
export type AgentNarrativeMeta = {
  source: "llm" | "deterministic";
  providerName?: AiProviderName;
  degradedReason?: string;
};

export type AgentEnrichmentResult = {
  output: AgentOutput;
  narrative: AgentNarrativeMeta;
};

// Rewrites an agent's deterministic findings/caveats/recommendations as a
// grounded Chinese narrative using the configured model, while keeping the
// facts, evidence links and human-approval flags deterministic. The model must
// cite fact indices (factRefs) per finding; those indices are mapped back to
// the real fact sources, so every finding's evidence reflects what the model
// actually relied on. Guardrails drop violating items individually (invalid
// factRefs, unsourced numbers); only when nothing survives does the whole
// output fall back to the deterministic version. A missing/failing model never
// breaks the caller.
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
  ledgerExtras,
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
  ledgerExtras?: {
    objectType?: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<AgentEnrichmentResult> {
  const deterministic = (degradedReason: string): AgentEnrichmentResult => ({
    output,
    narrative: { source: "deterministic", degradedReason },
  });

  const resolvedProviders = providers ?? createConfiguredAiProviders();
  const hasRealProvider = resolvedProviders.some(
    (provider) =>
      provider.name === "openai" ||
      provider.name === "hunyuan" ||
      provider.name === "deepseek",
  );
  if (!hasRealProvider) {
    return deterministic("provider_unconfigured");
  }
  if (output.facts.length === 0) {
    return deterministic("no_facts");
  }

  const routing = resolveAiProviderRouting();
  const resolvedPrimary = primaryProvider ?? routing.primaryProvider;

  const messages: AiMessage[] = [
    { role: "system", content: buildAgentSystemPrompt(role) },
    {
      role: "user",
      content: buildEnrichmentUserPrompt({ contextLines, facts: output.facts }),
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
        promptVersion: ENRICHMENT_PROMPT_VERSION,
        messages,
        responseSchema: enrichmentSchema,
      },
    });
  } catch {
    return deterministic("gateway_error");
  }

  // 影子评估并未真正执行,只是配置值;记入 metadata 而非 shadow_provider
  // 列,避免账本暗示"影子调用已运行"。
  const ledgerMetadata: Record<string, unknown> = {
    ...(routing.shadowProvider
      ? { configuredShadowProvider: routing.shadowProvider }
      : {}),
    ...(ledgerExtras?.metadata ?? {}),
  };
  await recordInvocation({
    client,
    actor,
    input: {
      scene,
      ...(ledgerExtras?.objectType
        ? { objectType: ledgerExtras.objectType }
        : {}),
      providerName: gatewayResult.providerName,
      primaryProvider: resolvedPrimary,
      status: gatewayResult.status as AiInvocationStatus,
      promptKey: scene,
      promptVersion: ENRICHMENT_PROMPT_VERSION,
      usage: gatewayResult.usage,
      costCents: gatewayResult.costCents,
      latencyMs: gatewayResult.latencyMs,
      degradedReason: gatewayResult.degradedReason,
      errorSummary: gatewayResult.errorSummary,
      ...(Object.keys(ledgerMetadata).length
        ? { metadata: ledgerMetadata }
        : {}),
    },
  }).catch(() => {});

  if (
    gatewayResult.status !== "succeeded" ||
    !gatewayResult.providerName ||
    gatewayResult.providerName === "deterministic"
  ) {
    return deterministic(gatewayResult.degradedReason ?? "model_call_failed");
  }

  const parsed = enrichmentSchema.safeParse(gatewayResult.structuredOutput);
  if (!parsed.success) {
    return deterministic("schema_validation_failed");
  }

  // Map the model's factRefs back to the referenced facts. Guardrails are
  // per-item: a finding is dropped when its references are all invalid or when
  // it states numbers absent from its cited facts; caveats/recommendations may
  // only restate numbers present in any fact. Recommendations carry factRefs
  // only as a grounding filter (the output contract has no evidence field for
  // them).
  const factEvidence: Evidence[] = output.facts.map((fact) => ({
    sourceTool: fact.sourceTool,
    sourceId: fact.sourceId,
  }));
  const resolveRefs = (refs: number[] | undefined): number[] | null => {
    if (!refs?.length) {
      return null;
    }
    const seen = new Set<number>();
    const valid = refs.filter(
      (index) =>
        Number.isInteger(index) &&
        index >= 0 &&
        index < factEvidence.length &&
        !seen.has(index) &&
        (seen.add(index), true),
    );
    return valid.length > 0 ? valid : null;
  };
  const allFactNumbers = collectNumberTokens(
    output.facts.map((fact) => fact.statement),
  );

  const findings = parsed.data.findings.flatMap((finding) => {
    const refs = resolveRefs(finding.factRefs);
    if (!refs) {
      return [];
    }
    const citedNumbers = collectNumberTokens(
      refs.map((index) => output.facts[index].statement),
    );
    if (hasUnsourcedNumber(finding.summary, citedNumbers)) {
      return [];
    }
    return [
      {
        summary: finding.summary,
        evidence: refs.map((index) => factEvidence[index]),
      },
    ];
  });
  if (findings.length === 0) {
    return deterministic("all_findings_dropped");
  }

  const recommendations = parsed.data.recommendations
    .filter(
      (recommendation) =>
        (!recommendation.factRefs?.length ||
          resolveRefs(recommendation.factRefs) !== null) &&
        !hasUnsourcedNumber(recommendation.proposal, allFactNumbers) &&
        !hasUnsourcedNumber(recommendation.expectedImpact, allFactNumbers),
    )
    .map((recommendation) => ({
      proposal: recommendation.proposal,
      ...(recommendation.expectedImpact
        ? { expectedImpact: recommendation.expectedImpact }
        : {}),
      requiresHumanApproval: true as const,
    }));
  if (recommendations.length === 0) {
    return deterministic("all_recommendations_dropped");
  }

  const caveats = (parsed.data.caveats ?? [])
    .filter((caveat) => !hasUnsourcedNumber(caveat.summary, allFactNumbers))
    .map((caveat) => ({
      summary: caveat.summary,
      unverifiedExternalFactor: true as const,
    }));

  const enriched: AgentOutput = {
    facts: output.facts,
    findings,
    caveats,
    recommendations,
  };

  if (!validateAgentOutput(enriched).valid) {
    return deterministic("guardrail_rejected");
  }

  return {
    output: enriched,
    narrative: { source: "llm", providerName: gatewayResult.providerName },
  };
}
