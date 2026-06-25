import { describe, expect, it } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import { runScriptOptimizationAgent } from "./script-optimization-agent";
import type { AgentOutput } from "./contracts";

describe("runScriptOptimizationAgent", () => {
  it("creates a grounded draft script version without publishing", () => {
    const result = runScriptOptimizationAgent({
      scriptKey: "opening-hook",
      version: 1,
      currentScript: "Welcome to the stream.",
      diagnosisType: "traffic_drop",
      feedback: ["weak opening"],
      replayNotes: ["viewers left during intro"],
    });

    expect(result.scriptVersionDraft).toMatchObject({
      scriptKey: "opening-hook",
      version: 1,
      status: "draft",
      content: expect.stringContaining("Opening hook"),
    });
    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: "Script version is 1",
          sourceTool: "script_optimization",
          sourceId: "script_optimization:opening-hook:version",
        }),
        expect.objectContaining({
          statement: "Feedback item count is 1",
          sourceId: "script_optimization:opening-hook:feedbackCount",
        }),
        expect.objectContaining({
          statement: "Replay note count is 1",
          sourceId: "script_optimization:opening-hook:replayNoteCount",
        }),
      ]),
    );
    expect(result.agentOutput.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: "Save the draft for human script review",
          requiresHumanApproval: true,
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("defaults invalid versions to a positive draft version", () => {
    const result = runScriptOptimizationAgent({
      scriptKey: "closing",
      version: -1,
      currentScript: "",
      diagnosisType: "content_rhythm",
      feedback: [],
      replayNotes: [],
    });

    expect(result.scriptVersionDraft).toMatchObject({
      scriptKey: "closing",
      version: 1,
      status: "draft",
    });
    expect(result.validation.valid).toBe(true);
    expectNoNumbersOutsideFacts(result.agentOutput);
  });
});

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
