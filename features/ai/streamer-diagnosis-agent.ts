import { validateAgentOutput } from "./agent-output-contract";
import { runAiToolQuery, type AiToolResult } from "./ai-tool-layer";
import type { AgentOutput, AiActor } from "./contracts";

type StreamerDiagnosisClient = Parameters<typeof runAiToolQuery>[0]["client"];

export type StreamerDiagnosisAgentResult = {
  result: AiToolResult;
  agentOutput: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

export async function runStreamerDiagnosisAgent({
  client,
  actor,
  input,
}: {
  client: StreamerDiagnosisClient;
  actor: AiActor;
  input: Record<string, unknown>;
}): Promise<StreamerDiagnosisAgentResult> {
  const result = await runAiToolQuery({
    client,
    actor,
    toolName: "streamer_diagnosis",
    input,
  });
  const agentOutput = buildStreamerDiagnosisAgentOutput(result);
  const validation = validateAgentOutput(agentOutput);

  return { result, agentOutput, validation };
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
