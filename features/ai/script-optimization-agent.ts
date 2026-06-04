import { validateAgentOutput } from "./agent-output-contract";
import type { AgentOutput } from "./contracts";

export type ScriptOptimizationInput = {
  scriptKey: string;
  version: number;
  currentScript: string;
  diagnosisType?: string;
  feedback?: string[];
  replayNotes?: string[];
  streamerId?: string;
  projectId?: string;
};

export type ScriptVersionDraft = {
  scriptKey: string;
  version: number;
  status: "draft";
  content: string;
  streamerId?: string;
  projectId?: string;
};

export type ScriptOptimizationAgentResult = {
  scriptVersionDraft: ScriptVersionDraft;
  agentOutput: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

const sourceTool = "script_optimization";

export function runScriptOptimizationAgent(
  input: ScriptOptimizationInput,
): ScriptOptimizationAgentResult {
  const normalized = normalizeInput(input);
  const scriptVersionDraft: ScriptVersionDraft = {
    scriptKey: normalized.scriptKey,
    version: normalized.version,
    status: "draft",
    content: buildScriptDraftContent(normalized),
    ...(normalized.streamerId ? { streamerId: normalized.streamerId } : {}),
    ...(normalized.projectId ? { projectId: normalized.projectId } : {}),
  };
  const agentOutput = buildAgentOutput(normalized);
  const validation = validateAgentOutput(agentOutput);

  return { scriptVersionDraft, agentOutput, validation };
}

function buildAgentOutput(input: RequiredScriptOptimizationInput): AgentOutput {
  const facts = collectScriptFacts(input);

  return {
    facts,
    findings: [
      {
        summary:
          input.diagnosisType === "traffic_drop"
            ? "Opening hook needs clearer audience action"
            : "Script rhythm needs tighter interaction pacing",
        evidence: [
          source(input.scriptKey, "diagnosisType"),
          source(input.scriptKey, "feedbackCount"),
        ],
      },
      {
        summary: "Replay notes support drafting a revised script for review",
        evidence: [source(input.scriptKey, "replayNoteCount")],
      },
    ],
    caveats: [
      {
        summary: "Platform traffic movement was not independently verified",
        unverifiedExternalFactor: true,
      },
      {
        summary: "Draft quality still depends on human review of the replay",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations: [
      {
        proposal: "Save the draft for human script review",
        expectedImpact: "Improve delivery consistency before publishing",
        requiresHumanApproval: true,
      },
      {
        proposal: "Compare the draft against replay evidence before use",
        expectedImpact: "Reduce the chance of acting on incomplete context",
        requiresHumanApproval: true,
      },
    ],
  };
}

function collectScriptFacts(
  input: RequiredScriptOptimizationInput,
): AgentOutput["facts"] {
  return [
    {
      statement: `Script version is ${input.version}`,
      ...source(input.scriptKey, "version"),
    },
    {
      statement: `Current script length is ${input.currentScript.length} characters`,
      ...source(input.scriptKey, "currentScriptLength"),
    },
    {
      statement: `Feedback item count is ${input.feedback.length}`,
      ...source(input.scriptKey, "feedbackCount"),
    },
    {
      statement: `Replay note count is ${input.replayNotes.length}`,
      ...source(input.scriptKey, "replayNoteCount"),
    },
    {
      statement: `Diagnosis type is ${input.diagnosisType}`,
      ...source(input.scriptKey, "diagnosisType"),
    },
  ];
}

function buildScriptDraftContent(input: RequiredScriptOptimizationInput): string {
  const baseScript = input.currentScript.trim() || "Start with a clear promise.";
  const feedbackLine = input.feedback[0]?.trim() || "Make the opening easier to follow.";
  const replayLine = input.replayNotes[0]?.trim() || "Review the replay before publishing.";

  return [
    `Opening hook: ${baseScript}`,
    `Audience action: Ask viewers to respond to the key product question.`,
    `Rhythm adjustment: ${feedbackLine}`,
    `Replay check: ${replayLine}`,
    "Review note: Keep this draft unpublished until a human approves it.",
  ].join("\n");
}

type RequiredScriptOptimizationInput = {
  scriptKey: string;
  version: number;
  currentScript: string;
  diagnosisType: string;
  feedback: string[];
  replayNotes: string[];
  streamerId?: string;
  projectId?: string;
};

function normalizeInput(
  input: ScriptOptimizationInput,
): RequiredScriptOptimizationInput {
  return {
    scriptKey: input.scriptKey.trim() || "default-script",
    version:
      Number.isFinite(input.version) && input.version > 0
        ? Math.trunc(input.version)
        : 1,
    currentScript: input.currentScript,
    diagnosisType: input.diagnosisType?.trim() || "content_rhythm",
    feedback: input.feedback?.map(String) ?? [],
    replayNotes: input.replayNotes?.map(String) ?? [],
    ...(input.streamerId ? { streamerId: input.streamerId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
  };
}

function source(
  scriptKey: string,
  field: string,
): { sourceTool: string; sourceId: string } {
  return {
    sourceTool,
    sourceId: `${sourceTool}:${scriptKey}:${field}`,
  };
}
