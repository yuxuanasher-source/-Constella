import type { SupabaseClient } from "@supabase/supabase-js";

import {
  enrichAgentOutputWithLlm,
  type AgentNarrativeMeta,
} from "./agent-llm-enrichment";
import { validateAgentOutput } from "./agent-output-contract";
import { runAiToolQuery, type AiToolResult } from "./ai-tool-layer";
import type { AgentOutput, AiActor, AiProvider, AiProviderName } from "./contracts";
import { recordAiInvocation } from "./invocation-ledger";
import { runAiGateway } from "./llm-gateway";
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

const STREAMER_DIAGNOSIS_ROLE =
  "你是 MCN 直播运营的资深诊断助手,基于运营系统给出的「事实」为主播本场直播做诊断。";

export type StreamerDiagnosisAgentResult = {
  result: AiToolResult;
  agentOutput: AgentOutput;
  narrative: AgentNarrativeMeta;
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

  // Deterministic, evidence-grounded output is always available as a fallback;
  // the shared enrichment returns it unchanged when no real model is
  // configured or the model output fails the guardrails.
  const fallbackOutput = buildStreamerDiagnosisAgentOutput(result);
  const diagnosisType = stringValue(
    result.output.diagnosisType,
    "content_rhythm",
  );

  const { output: agentOutput, narrative } = await enrichAgentOutputWithLlm({
    output: fallbackOutput,
    scene: "streamer_diagnosis",
    role: STREAMER_DIAGNOSIS_ROLE,
    contextLines: [`诊断类型:${diagnosisType}`],
    client,
    actor,
    providers,
    primaryProvider,
    runGateway,
    recordInvocation,
    ledgerExtras: {
      objectType: "streamer",
      metadata: { diagnosisType },
    },
  });
  const validation = validateAgentOutput(agentOutput);

  return { result, agentOutput, narrative, validation };
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
          ? "互动模式需要在下一场直播前重点调整"
          : "内容节奏需要在下一场直播前重点调整",
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
      summary: "证据置信度需人工复核后再采信本次诊断",
      evidence: [source(result.invocationId, "report.evidenceLevel")],
    });
  }

  return {
    facts,
    findings,
    caveats: [
      {
        summary: "平台流量波动未经过独立核验",
        unverifiedExternalFactor: true,
      },
      {
        summary: "本次诊断缺少历史基线数据",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations: [
      {
        proposal: "下一场开播前优化开场钩子与互动节奏",
        expectedImpact: "在保留人工复核的前提下改善留存信号",
        requiresHumanApproval: true,
      },
      {
        proposal: "调整任务或结算记录前先复核回放证据",
        expectedImpact: "避免基于不完整的运营证据做决策",
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
    "本场总观看数",
  );
  pushNumberFact(
    facts,
    result.invocationId,
    "report.settlementDuration",
    report.settlementDuration,
    "结算时长",
    " 分钟",
  );
  pushTextFact(
    facts,
    result.invocationId,
    "report.evidenceLevel",
    report.evidenceLevel,
    "证据等级",
  );
  facts.push({
    statement: `反馈条数为 ${feedback.length}`,
    ...source(result.invocationId, "input.feedbackCount"),
  });
  pushTextFact(
    facts,
    result.invocationId,
    "output.diagnosisType",
    result.output.diagnosisType,
    "诊断类型",
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
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  facts.push({
    statement: `${label}为 ${Math.trunc(value)}${suffix}`,
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
    statement: `${label}为 ${text}`,
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
