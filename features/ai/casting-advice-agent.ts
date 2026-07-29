import { validateAgentOutput } from "./agent-output-contract";
import type { AgentOutput } from "./contracts";
import {
  rankStreamerCandidates,
  type MatchingProjectContext,
  type StreamerCandidateSnapshot,
  type StreamerMatchResult,
} from "@/features/war-room/matching-engine";

export type CastingAdviceInput = {
  project: MatchingProjectContext;
  candidates: StreamerCandidateSnapshot[];
  maxRecommendations?: number;
};

export type CandidateAdvice = {
  streamerId: string;
  streamerName: string;
  rank: number;
  suggestedSettlementMethod: StreamerMatchResult["suggestedSettlementMethod"];
  recommendation: "invite" | "backup" | "manual_review";
  reasons: string[];
  riskNotes: string[];
};

export type CastingAdviceAgentResult = {
  matches: StreamerMatchResult[];
  candidateAdvice: CandidateAdvice[];
  agentOutput: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

const sourceTool = "casting_advice";

export function runCastingAdviceAgent(
  input: CastingAdviceInput,
): CastingAdviceAgentResult {
  const matches = rankStreamerCandidates({
    project: input.project,
    candidates: input.candidates,
  });
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const candidateAdvice = matches
    .slice(0, recommendationLimit(input.maxRecommendations, matches.length))
    .map((match, index) =>
      buildCandidateAdvice(
        match,
        candidateById.get(match.streamerId),
        input.project,
        index,
      ),
    );
  const agentOutput = buildAgentOutput(input, matches, candidateById);
  const validation = validateAgentOutput(agentOutput);

  return {
    matches,
    candidateAdvice,
    agentOutput,
    validation,
  };
}

function buildCandidateAdvice(
  match: StreamerMatchResult,
  candidate: StreamerCandidateSnapshot | undefined,
  project: MatchingProjectContext,
  index: number,
): CandidateAdvice {
  return {
    streamerId: match.streamerId,
    streamerName: match.streamerName,
    rank: index + 1,
    suggestedSettlementMethod: match.suggestedSettlementMethod,
    recommendation: classifyRecommendation(match, candidate, project),
    reasons: match.reasons,
    riskNotes: match.riskNotes,
  };
}

function classifyRecommendation(
  match: StreamerMatchResult,
  candidate: StreamerCandidateSnapshot | undefined,
  project: MatchingProjectContext,
): CandidateAdvice["recommendation"] {
  const hardRiskNotes = match.riskNotes.filter(
    (riskNote) => riskNote !== "availability_shortage",
  );

  if (hardRiskNotes.length > 0) {
    return "manual_review";
  }
  if (candidate && candidate.availableMinutes < project.requiredMinutes) {
    return "backup";
  }
  if (match.score >= 70 && candidate) {
    return "invite";
  }
  return "backup";
}

function buildAgentOutput(
  input: CastingAdviceInput,
  matches: StreamerMatchResult[],
  candidateById: Map<string, StreamerCandidateSnapshot>,
): AgentOutput {
  const facts = collectFacts(input, matches, candidateById);
  const topMatch = matches[0];
  const firstRisky = matches.find((match) => match.riskNotes.length > 0);
  const firstShortage = matches.find((match) => {
    const candidate = candidateById.get(match.streamerId);
    return candidate
      ? candidate.availableMinutes < input.project.requiredMinutes
      : false;
  });

  return {
    facts,
    findings: buildFindings(input, topMatch, firstRisky, firstShortage),
    caveats: [
      {
        summary: "Platform traffic and calendar conflicts were not verified",
        unverifiedExternalFactor: true,
      },
      {
        summary: "Recent off-platform performance changes were not verified",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations: buildRecommendations(topMatch, firstRisky),
  };
}

function collectFacts(
  input: CastingAdviceInput,
  matches: StreamerMatchResult[],
  candidateById: Map<string, StreamerCandidateSnapshot>,
): AgentOutput["facts"] {
  return [
    {
      statement: `Candidate count is ${input.candidates.length}`,
      ...source("project", "candidateCount"),
    },
    {
      statement: `Project required minutes is ${input.project.requiredMinutes}`,
      ...source("project", "requiredMinutes"),
    },
    ...matches.flatMap((match, index) => {
      const candidate = candidateById.get(match.streamerId);

      return [
        {
          statement: `${match.streamerName} match score is ${match.score}`,
          ...source(match.streamerId, "score"),
        },
        {
          statement: `${match.streamerName} rank is ${index + 1}`,
          ...source(match.streamerId, "rank"),
        },
        {
          statement: `${match.streamerName} available minutes is ${
            candidate?.availableMinutes ?? 0
          }`,
          ...source(match.streamerId, "availableMinutes"),
        },
        {
          statement: `${match.streamerName} risk note count is ${match.riskNotes.length}`,
          ...source(match.streamerId, "riskNoteCount"),
        },
        ...(candidate?.profileInsights ?? []).map((insight) => ({
          statement: `${match.streamerName} profile insight ${insight.title}: ${insight.summary}`,
          sourceTool: "streamer_profile_insights",
          sourceId:
            insight.sourceRef ||
            `streamer_profile_insights:${match.streamerId}:${insight.id}`,
        })),
      ];
    }),
  ];
}

function buildFindings(
  input: CastingAdviceInput,
  topMatch: StreamerMatchResult | undefined,
  firstRisky: StreamerMatchResult | undefined,
  firstShortage: StreamerMatchResult | undefined,
): AgentOutput["findings"] {
  if (!topMatch) {
    return [
      {
        summary: "Candidate review needs source snapshots before ranking",
        evidence: [source("project", "candidateCount")],
      },
    ];
  }

  const findings: AgentOutput["findings"] = [
    {
      summary: "Top candidate is ready for invitation review",
      evidence: [
        source(topMatch.streamerId, "score"),
        source(topMatch.streamerId, "availableMinutes"),
      ],
    },
  ];

  if (firstRisky) {
    findings.push({
      summary: "Some candidates need manual risk review before invitation",
      evidence: [source(firstRisky.streamerId, "riskNoteCount")],
    });
  }

  if (firstShortage) {
    findings.push({
      summary: "Candidate coverage may be constrained by availability",
      evidence: [
        source("project", "requiredMinutes"),
        source(firstShortage.streamerId, "availableMinutes"),
      ],
    });
  } else if (input.project.requiredMinutes > 0) {
    findings.push({
      summary: "Available minutes support the current casting review",
      evidence: [
        source("project", "requiredMinutes"),
        source(topMatch.streamerId, "availableMinutes"),
      ],
    });
  }

  return findings;
}

function buildRecommendations(
  topMatch: StreamerMatchResult | undefined,
  firstRisky: StreamerMatchResult | undefined,
): AgentOutput["recommendations"] {
  if (!topMatch) {
    return [
      {
        proposal: "Collect candidate snapshots before invitation review",
        expectedImpact:
          "Avoid making allocation decisions from incomplete casting context",
        requiresHumanApproval: true,
      },
    ];
  }

  return [
    {
      proposal: "Invite the highest ranked candidate after manual review",
      expectedImpact: "Improve fit while keeping approval control",
      requiresHumanApproval: true,
    },
    ...(firstRisky
      ? [
          {
            proposal: "Review risky candidates before backup use",
            expectedImpact: "Reduce allocation risk before outreach",
            requiresHumanApproval: true as const,
          },
        ]
      : []),
  ];
}

function recommendationLimit(
  maxRecommendations: number | undefined,
  matchCount: number,
): number {
  if (!Number.isFinite(maxRecommendations) || !maxRecommendations) {
    return matchCount;
  }

  return Math.max(0, Math.min(matchCount, Math.trunc(maxRecommendations)));
}

function source(
  entityId: string,
  field: string,
): { sourceTool: string; sourceId: string } {
  return {
    sourceTool,
    sourceId: `${sourceTool}:${entityId}:${field}`,
  };
}
