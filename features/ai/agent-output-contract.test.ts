import { describe, expect, it } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import type { AgentOutput } from "./contracts";

const validOutput: AgentOutput = {
  facts: [
    {
      statement: "Project margin is 4167 bps",
      sourceTool: "project_review_summary",
      sourceId: "tool-1",
    },
  ],
  findings: [
    {
      summary: "Margin is above the continuation threshold",
      evidence: [{ sourceTool: "project_review_summary", sourceId: "tool-1" }],
    },
  ],
  caveats: [
    {
      summary: "Competitor launch calendar was not verified",
      unverifiedExternalFactor: true,
    },
  ],
  recommendations: [
    {
      proposal: "Continue the project with the current streamer mix",
      expectedImpact: "Protect margin while collecting more samples",
      requiresHumanApproval: true,
    },
  ],
};

describe("validateAgentOutput", () => {
  it("accepts grounded facts, findings, caveats, and recommendations", () => {
    expect(validateAgentOutput(validOutput)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects findings that do not cite a fact or tool source", () => {
    const result = validateAgentOutput({
      ...validOutput,
      findings: [{ summary: "Uncited conclusion", evidence: [] }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "findings[0] must include at least one evidence reference",
    );
  });

  it("rejects recommendations that can execute without human approval", () => {
    const result = validateAgentOutput({
      ...validOutput,
      recommendations: [
        {
          proposal: "Auto-approve the review",
          requiresHumanApproval: false,
        },
      ],
    } as unknown as AgentOutput);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "recommendations[0] must require human approval",
    );
  });
});
