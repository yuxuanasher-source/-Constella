import { describe, expect, it } from "vitest";

import {
  KEY_MOMENT_KEYS,
  RECORDING_PRODUCTION_DIMENSIONS,
  classifySelfAssessmentLevel,
  normalizeRecordingSelfCheck,
  rerecordSuggestionLabel,
} from "./recording-production-standard";

describe("recording production standard", () => {
  it("keeps the six-dimension weights aligned to 100 points", () => {
    expect(RECORDING_PRODUCTION_DIMENSIONS.map((item) => item.key)).toEqual([
      "product_understanding",
      "expression_control",
      "content_structure",
      "interaction_design",
      "commercial_task",
      "technical_compliance",
    ]);
    expect(
      RECORDING_PRODUCTION_DIMENSIONS.reduce(
        (sum, item) => sum + item.weight,
        0,
      ),
    ).toBe(100);
  });

  it("requires read confirmation, all six scores, and three key moments", () => {
    const normalized = normalizeRecordingSelfCheck({
      readConfirmed: true,
      dimensionScores: {
        product_understanding: 20,
        expression_control: 18,
        content_structure: 12,
        interaction_design: 11,
        commercial_task: 12,
        technical_compliance: 9,
      },
      keyMoments: [
        { key: "best_performance", startSeconds: 30, endSeconds: 80 },
        { key: "selling_point", startSeconds: 120, endSeconds: 180 },
        { key: "commercial_task", startSeconds: 240, endSeconds: 300 },
      ],
      note: "已完整回看一次。",
    });

    expect(normalized.totalScore).toBe(82);
    expect(normalized.selfLevel).toBe("L3");
    expect(normalized.keyMoments.map((item) => item.key)).toEqual(
      KEY_MOMENT_KEYS,
    );
  });

  it("does not use rerecord wording as a business decision", () => {
    expect(rerecordSuggestionLabel("clip")).toBe("建议补录指定片段");
    expect(rerecordSuggestionLabel("full")).toBe("建议整段重录");
    expect(rerecordSuggestionLabel("none")).toBe("暂无重录建议");
  });

  it("classifies self-assessment levels without blocking submission", () => {
    expect(classifySelfAssessmentLevel(95)).toBe("L4");
    expect(classifySelfAssessmentLevel(80)).toBe("L3");
    expect(classifySelfAssessmentLevel(70)).toBe("L2");
    expect(classifySelfAssessmentLevel(60)).toBe("L1");
    expect(classifySelfAssessmentLevel(30)).toBe("L0");
  });
});
