import { describe, expect, it } from "vitest";

import {
  checkpointsForStage,
  DEFAULT_ADMISSION_CHECKPOINTS,
  defaultAdmissionRubric,
  failedHardBlocks,
  normalizeReasonCodes,
} from "./contracts";

describe("admission review contracts", () => {
  it("keeps the mcn_first form at or under 10 checkpoints with hard blocks first", () => {
    const rubric = defaultAdmissionRubric();
    const mcnCheckpoints = checkpointsForStage(rubric, "mcn_first");

    expect(mcnCheckpoints.length).toBeLessThanOrEqual(10);
    const severities = mcnCheckpoints.map((checkpoint) => checkpoint.severity);
    const lastHardBlock = severities.lastIndexOf("hard_block");
    const firstNonHard = severities.findIndex(
      (severity) => severity !== "hard_block",
    );
    expect(lastHardBlock).toBeLessThan(firstNonHard);
  });

  it("filters vendor stage checkpoints to both/vendor_second", () => {
    const rubric = defaultAdmissionRubric();
    const vendorCheckpoints = checkpointsForStage(rubric, "vendor_second");

    expect(
      vendorCheckpoints.every(
        (checkpoint) =>
          checkpoint.applicableStage === "both" ||
          checkpoint.applicableStage === "vendor_second",
      ),
    ).toBe(true);
    expect(vendorCheckpoints.map((c) => c.key)).toContain("persona_fit");
    expect(vendorCheckpoints.map((c) => c.key)).not.toContain(
      "media_unusable",
    );
  });

  it("normalizes reason codes and rejects unknown keys", () => {
    const rubric = defaultAdmissionRubric();

    expect(
      normalizeReasonCodes(rubric, "mcn_first", [
        " script_fit ",
        "script_fit",
        "media_quality",
      ]),
    ).toEqual(["script_fit", "media_quality"]);

    expect(() =>
      normalizeReasonCodes(rubric, "mcn_first", ["not_a_checkpoint"]),
    ).toThrow(/Unknown admission reason code/);

    // persona_fit 仅适用二审，不是一审的合法理由码。
    expect(() =>
      normalizeReasonCodes(rubric, "mcn_first", ["persona_fit"]),
    ).toThrow(/Unknown admission reason code/);
  });

  it("detects failed hard blocks only", () => {
    const rubric = defaultAdmissionRubric();

    expect(
      failedHardBlocks(rubric, [
        { checkpointKey: "compliance_violation", verdict: "fail" },
        { checkpointKey: "script_fit", verdict: "fail" },
        { checkpointKey: "media_unusable", verdict: "pass" },
      ]),
    ).toEqual(["compliance_violation"]);

    expect(
      failedHardBlocks(rubric, [
        { checkpointKey: "script_fit", verdict: "fail" },
      ]),
    ).toEqual([]);
  });

  it("keeps every default checkpoint key unique", () => {
    const keys = DEFAULT_ADMISSION_CHECKPOINTS.map(
      (checkpoint) => checkpoint.key,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
