import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { validateAgentOutput } from "./agent-output-contract";
import { runAiToolQuery, type AiToolResult } from "./ai-tool-layer";
import type {
  AgentOutput,
  AiActor,
  AiGatewayResult,
  AiMessage,
  AiInvocationStatus,
  AiProvider,
  AiProviderName,
} from "./contracts";
import { runAiGateway } from "./llm-gateway";
import { recordAiInvocation } from "./invocation-ledger";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "./provider-registry";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";

type StreamerDiagnosisClient = Parameters<typeof runAiToolQuery>[0]["client"];

export type StreamerDiagnosisContext = {
  report?: Record<string, unknown>;
  feedback?: string[];
};

type StreamerLatestReportRow = {
  viewers: number | null;
  settlement_duration: number | null;
  evidence_level: string | null;
  risk_flags: string[] | null;
};

// Pulls the streamer's most recent live-report metrics so the model has real
// numbers to diagnose instead of an empty request body. Scoped to the
// authenticated streamer's own data; failures degrade to no context.
export async function gatherStreamerDiagnosisContext({
  client,
  actor,
}: {
  client: SupabaseClient;
  actor: AiActor;
}): Promise<StreamerDiagnosisContext> {
  try {
    const streamerId = await getStreamerIdForUser(
      client,
      actor.userId,
      actor.organizationId,
    );
    if (!streamerId) {
      return {};
    }

    const { data, error } = await client
      .from("live_reports")
      .select("viewers, settlement_duration, evidence_level, risk_flags")
      .eq("organization_id", actor.organizationId)
      .eq("streamer_id", streamerId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || !data[0]) {
      return {};
    }

    const row = data[0] as StreamerLatestReportRow;
    const report: Record<string, unknown> = {};
    if (typeof row.viewers === "number") {
      report.totalViews = row.viewers;
    }
    if (typeof row.settlement_duration === "number") {
      report.settlementDuration = row.settlement_duration;
    }
    if (row.evidence_level) {
      report.evidenceLevel = row.evidence_level;
    }
    const feedback = Array.isArray(row.risk_flags)
      ? row.risk_flags.map(String).filter(Boolean)
      : [];

    return {
      report: Object.keys(report).length > 0 ? report : undefined,
      feedback: feedback.length > 0 ? feedback : undefined,
    };
  } catch {
    return {};
  }
}

const STREAMER_DIAGNOSIS_PROMPT_KEY = "streamer_diagnosis";
const STREAMER_DIAGNOSIS_PROMPT_VERSION = 1;

const STREAMER_DIAGNOSIS_SYSTEM_PROMPT = [
  "你是 MCN 直播运营的资深诊断助手,基于运营系统给出的「事实」为主播本场直播做诊断。",
  "严格规则:",
  "1. 只能依据下方提供的事实,不得编造任何数据、平台信息或外部因素。",
  "2. findings(结论)、caveats(风险提示)、recommendations(建议)的文字中禁止出现任何阿拉伯数字(0-9);需要表达数值时用定性描述,例如「偏低」「明显下滑」「高于均值」。",
  "3. 所有建议都必须经人工确认后才能执行,不要给出可直接自动执行的指令。",
  "4. 使用简洁、专业、可执行的中文。",
  '5. 只返回 JSON,结构为:{"findings":[{"summary":"..."}],"caveats":[{"summary":"..."}],"recommendations":[{"proposal":"...","expectedImpact":"..."}]}。',
].join("\n");

const diagnosisLlmSchema = z.object({
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

export type StreamerDiagnosisAgentResult = {
  result: AiToolResult;
  agentOutput: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

export async function runStreamerDiagnosisAgent({
  client,
  actor,
  input,
  providers,
  primaryProvider,
  runGateway = runAiGateway,
  recordInvocation = recordAiInvocation,
}: {
  client: StreamerDiagnosisClient;
  actor: AiActor;
  input: Record<string, unknown>;
  providers?: AiProvider[];
  primaryProvider?: AiProviderName;
  runGateway?: typeof runAiGateway;
  recordInvocation?: typeof recordAiInvocation;
}): Promise<StreamerDiagnosisAgentResult> {
  const result = await runAiToolQuery({
    client,
    actor,
    toolName: "streamer_diagnosis",
    input,
  });

  // Deterministic, evidence-grounded output is always available as a fallback.
  const fallbackOutput = buildStreamerDiagnosisAgentOutput(result);

  // When a real model is configured, let it write the narrative (in Chinese)
  // while the facts, evidence links and human-approval flags stay deterministic.
  const routing = resolveAiProviderRouting();
  const enriched = await enrichDiagnosisWithLlm({
    client,
    actor,
    result,
    providers: providers ?? createConfiguredAiProviders(),
    primaryProvider: primaryProvider ?? routing.primaryProvider,
    shadowProvider: routing.shadowProvider,
    runGateway,
    recordInvocation,
  });

  const agentOutput =
    enriched && validateAgentOutput(enriched).valid ? enriched : fallbackOutput;
  const validation = validateAgentOutput(agentOutput);

  return { result, agentOutput, validation };
}

async function enrichDiagnosisWithLlm({
  client,
  actor,
  result,
  providers,
  primaryProvider,
  shadowProvider,
  runGateway,
  recordInvocation,
}: {
  client: StreamerDiagnosisClient;
  actor: AiActor;
  result: AiToolResult;
  providers: AiProvider[];
  primaryProvider?: AiProviderName;
  shadowProvider?: AiProviderName;
  runGateway: typeof runAiGateway;
  recordInvocation: typeof recordAiInvocation;
}): Promise<AgentOutput | null> {
  const hasRealProvider = providers.some(
    (provider) => provider.name === "openai" || provider.name === "hunyuan",
  );
  if (!hasRealProvider) {
    return null;
  }

  const facts = collectStreamerFacts(result);
  const diagnosisType = stringValue(
    result.output.diagnosisType,
    "content_rhythm",
  );

  let gatewayResult: AiGatewayResult;
  try {
    gatewayResult = await runGateway({
      providers,
      primaryProvider,
      request: {
        kind: "structured",
        promptKey: STREAMER_DIAGNOSIS_PROMPT_KEY,
        promptVersion: STREAMER_DIAGNOSIS_PROMPT_VERSION,
        messages: buildDiagnosisMessages(facts, diagnosisType),
        responseSchema: diagnosisLlmSchema,
      },
    });
  } catch {
    return null;
  }

  // Record the model invocation for cost/usage tracking (best-effort).
  await recordInvocation({
    client,
    actor,
    input: {
      scene: "streamer_diagnosis",
      objectType: "streamer",
      providerName: gatewayResult.providerName,
      primaryProvider,
      shadowProvider,
      status: gatewayResult.status as AiInvocationStatus,
      promptKey: STREAMER_DIAGNOSIS_PROMPT_KEY,
      promptVersion: STREAMER_DIAGNOSIS_PROMPT_VERSION,
      usage: gatewayResult.usage,
      costCents: gatewayResult.costCents,
      latencyMs: gatewayResult.latencyMs,
      degradedReason: gatewayResult.degradedReason,
      errorSummary: gatewayResult.errorSummary,
      metadata: { diagnosisType },
    },
  }).catch(() => {});

  if (
    gatewayResult.status !== "succeeded" ||
    !gatewayResult.providerName ||
    gatewayResult.providerName === "deterministic"
  ) {
    return null;
  }

  const parsed = diagnosisLlmSchema.safeParse(gatewayResult.structuredOutput);
  if (!parsed.success) {
    return null;
  }

  const evidence = diagnosisEvidence(result, facts);
  return {
    facts,
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
}

function buildDiagnosisMessages(
  facts: AgentOutput["facts"],
  diagnosisType: string,
): AiMessage[] {
  const factLines = facts.map((fact) => `- ${fact.statement}`).join("\n");
  return [
    { role: "system", content: STREAMER_DIAGNOSIS_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `诊断类型:${diagnosisType}`,
        "以下是本场直播的事实数据:",
        factLines,
        "",
        "请基于以上事实输出诊断结论、风险提示与改进建议。",
      ].join("\n"),
    },
  ];
}

function diagnosisEvidence(
  result: AiToolResult,
  facts: AgentOutput["facts"],
): Array<{ sourceTool: string; sourceId: string }> {
  const factsByPath = new Map(
    facts.map((fact) => [fact.sourceId.split(":").at(-1), fact]),
  );
  const evidence = compactEvidence([
    factSource(factsByPath, result.invocationId, "report.totalViews"),
    factSource(factsByPath, result.invocationId, "output.diagnosisType"),
  ]);
  // Always reference at least one existing fact so findings stay grounded.
  return evidence.length > 0
    ? evidence
    : [source(result.invocationId, "input.feedbackCount")];
}

function buildStreamerDiagnosisAgentOutput(result: AiToolResult): AgentOutput {
  const facts = collectStreamerFacts(result);
  const factsByPath = new Map(
    facts.map((fact) => [fact.sourceId.split(":").at(-1), fact]),
  );
  const diagnosisType = stringValue(
    result.output.diagnosisType,
    "content_rhythm",
  );

  const rhythmEvidence = compactEvidence([
    factSource(factsByPath, result.invocationId, "report.totalViews"),
    factSource(factsByPath, result.invocationId, "output.diagnosisType"),
  ]);
  const findings: AgentOutput["findings"] = [
    {
      summary:
        diagnosisType === "traffic_drop"
          ? "Interaction pattern needs attention before the next live session"
          : "Content rhythm needs attention before the next live session",
      evidence:
        rhythmEvidence.length > 0
          ? rhythmEvidence
          : [source(result.invocationId, "output.diagnosisType")],
    },
  ];

  const evidenceLevel = stringValue(
    objectValue(objectValue(result.output.sourceSnapshot).report).evidenceLevel,
  );
  if (evidenceLevel && evidenceLevel !== "green") {
    findings.push({
      summary:
        "Evidence confidence needs manual review before relying on diagnosis",
      evidence: [source(result.invocationId, "report.evidenceLevel")],
    });
  }

  return {
    facts,
    findings,
    caveats: [
      {
        summary: "Platform traffic movement was not independently verified",
        unverifiedExternalFactor: true,
      },
      {
        summary:
          "Historical baseline was not available in this diagnosis request",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations: [
      {
        proposal:
          "Refine opening hook and interaction rhythm before the next session",
        expectedImpact:
          "Improve retention signals while preserving manual review",
        requiresHumanApproval: true,
      },
      {
        proposal:
          "Review replay evidence before changing task or settlement records",
        expectedImpact: "Avoid acting on incomplete operational evidence",
        requiresHumanApproval: true,
      },
    ],
  };
}

function collectStreamerFacts(result: AiToolResult): AgentOutput["facts"] {
  const sourceSnapshot = objectValue(result.output.sourceSnapshot);
  const report = objectValue(sourceSnapshot.report);
  const feedback = Array.isArray(sourceSnapshot.feedback)
    ? sourceSnapshot.feedback
    : [];
  const facts: AgentOutput["facts"] = [];

  pushNumberFact(
    facts,
    result.invocationId,
    "report.totalViews",
    report.totalViews,
    "Total views",
    "",
    "are",
  );
  pushNumberFact(
    facts,
    result.invocationId,
    "report.settlementDuration",
    report.settlementDuration,
    "Settlement duration",
    " minutes",
  );
  pushTextFact(
    facts,
    result.invocationId,
    "report.evidenceLevel",
    report.evidenceLevel,
    "Evidence level",
  );
  facts.push({
    statement: `Feedback item count is ${feedback.length}`,
    ...source(result.invocationId, "input.feedbackCount"),
  });
  pushTextFact(
    facts,
    result.invocationId,
    "output.diagnosisType",
    result.output.diagnosisType,
    "Diagnosis type",
  );

  return facts;
}

function pushNumberFact(
  facts: AgentOutput["facts"],
  invocationId: string,
  fieldPath: string,
  value: unknown,
  label: string,
  suffix = "",
  verb = "is",
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  facts.push({
    statement: `${label} ${verb} ${Math.trunc(value)}${suffix}`,
    ...source(invocationId, fieldPath),
  });
}

function pushTextFact(
  facts: AgentOutput["facts"],
  invocationId: string,
  fieldPath: string,
  value: unknown,
  label: string,
): void {
  const text = stringValue(value);
  if (!text) {
    return;
  }

  facts.push({
    statement: `${label} is ${text}`,
    ...source(invocationId, fieldPath),
  });
}

function compactEvidence(
  evidence: Array<{ sourceTool: string; sourceId: string } | undefined>,
): Array<{ sourceTool: string; sourceId: string }> {
  return evidence.filter(
    (item): item is { sourceTool: string; sourceId: string } => Boolean(item),
  );
}

function factSource(
  factsByPath: Map<string | undefined, AgentOutput["facts"][number]>,
  invocationId: string,
  fieldPath: string,
): { sourceTool: string; sourceId: string } | undefined {
  if (!factsByPath.has(fieldPath)) {
    return undefined;
  }
  return source(invocationId, fieldPath);
}

function source(
  invocationId: string,
  fieldPath: string,
): { sourceTool: string; sourceId: string } {
  return {
    sourceTool: "streamer_diagnosis",
    sourceId: `${invocationId}:${fieldPath}`,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
