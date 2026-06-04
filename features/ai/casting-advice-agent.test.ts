import { describe, expect, it } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import { runCastingAdviceAgent } from "./casting-advice-agent";
import type { AgentOutput } from "./contracts";
import type { CastingAdviceInput } from "./casting-advice-agent";

describe("runCastingAdviceAgent", () => {
  it("grounds casting advice in ranked matching facts", () => {
    const result = runCastingAdviceAgent(createInput());

    expect(result.matches[0]).toMatchObject({
      streamerId: "streamer-a",
      score: 93,
      suggestedSettlementMethod: "base_salary_cpt",
    });
    expect(result.candidateAdvice[0]).toMatchObject({
      streamerId: "streamer-a",
      rank: 1,
      recommendation: "invite",
    });
    expect(result.candidateAdvice).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          streamerId: "streamer-b",
          recommendation: "manual_review",
        }),
      ]),
    );
    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: "Ava match score is 93",
          sourceTool: "casting_advice",
          sourceId: "casting_advice:streamer-a:score",
        }),
        expect.objectContaining({
          statement: "Ava available minutes is 1200",
          sourceTool: "casting_advice",
          sourceId: "casting_advice:streamer-a:availableMinutes",
        }),
        expect.objectContaining({
          statement: "Project required minutes is 900",
          sourceTool: "casting_advice",
          sourceId: "casting_advice:project:requiredMinutes",
        }),
      ]),
    );
    expect(result.agentOutput.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Top candidate is ready for invitation review",
          evidence: [
            {
              sourceTool: "casting_advice",
              sourceId: "casting_advice:streamer-a:score",
            },
            {
              sourceTool: "casting_advice",
              sourceId: "casting_advice:streamer-a:availableMinutes",
            },
          ],
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("keeps advice proposals non-executable and bounded by maxRecommendations", () => {
    const result = runCastingAdviceAgent({
      ...createInput(),
      maxRecommendations: 1,
    });

    expect(result.candidateAdvice).toHaveLength(1);
    expect(result.candidateAdvice[0]).toMatchObject({
      streamerId: "streamer-a",
      recommendation: "invite",
    });
    expect(result.agentOutput.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: "Invite the highest ranked candidate after manual review",
          requiresHumanApproval: true,
        }),
      ]),
    );
    expect(JSON.stringify(result.agentOutput.recommendations)).not.toContain(
      "execute",
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("keeps risk-free candidates as backup when availability is short", () => {
    const result = runCastingAdviceAgent({
      project: {
        category: "moba",
        platform: "douyin",
        preferredStyles: ["high-energy"],
        requiredMinutes: 1000,
      },
      candidates: [
        {
          id: "streamer-short",
          name: "Cy",
          categories: ["moba"],
          platforms: ["douyin"],
          styles: ["high-energy"],
          completionRateBps: 9300,
          screeningPassRateBps: 9000,
          roiBps: 14000,
          grossMarginContributionCents: 150000,
          riskTags: [],
          availableMinutes: 400,
          referenceProjects: [],
        },
      ],
    });

    expect(result.candidateAdvice[0]).toMatchObject({
      streamerId: "streamer-short",
      recommendation: "backup",
    });
    expect(result.agentOutput.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Candidate coverage may be constrained by availability",
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });
});

function createInput(): CastingAdviceInput {
  return {
    project: {
      category: "moba",
      platform: "douyin",
      preferredStyles: ["high-energy", "teaching"],
      requiredMinutes: 900,
    },
    candidates: [
      {
        id: "streamer-a",
        name: "Ava",
        categories: ["moba", "fps"],
        platforms: ["douyin"],
        styles: ["high-energy", "story"],
        completionRateBps: 9200,
        screeningPassRateBps: 8800,
        roiBps: 14000,
        grossMarginContributionCents: 180000,
        riskTags: [],
        availableMinutes: 1200,
        referenceProjects: [
          {
            id: "project-a",
            name: "Campaign Alpha",
            result: "completed",
          },
        ],
      },
      {
        id: "streamer-b",
        name: "Bo",
        categories: ["slg"],
        platforms: ["kuaishou"],
        styles: ["casual"],
        completionRateBps: 5600,
        screeningPassRateBps: 4300,
        roiBps: 3000,
        grossMarginContributionCents: -20000,
        riskTags: ["recent_anomaly", "dispute"],
        availableMinutes: 300,
        referenceProjects: [],
      },
    ],
  };
}

function expectNoNumbersOutsideFacts(output: AgentOutput): void {
  expect(validateAgentOutput(output)).toEqual({ valid: true, errors: [] });
  const nonFactText = [
    ...output.findings.map((finding) => finding.summary),
    ...output.caveats.map((caveat) => caveat.summary),
    ...output.recommendations.flatMap((recommendation) => [
      recommendation.proposal,
      recommendation.expectedImpact ?? "",
    ]),
  ].join(" ");

  expect(nonFactText).not.toMatch(/\d/);
}
