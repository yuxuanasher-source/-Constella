import { describe, expect, it } from "vitest";

import { resolveReportEvidence } from "./live-report-evidence";

describe("live report evidence resolver", () => {
  it("uses system timing as green evidence when screenshot duration matches tolerance", () => {
    expect(
      resolveReportEvidence({
        systemDuration: 120,
        screenshotDuration: 126,
        claimedDuration: 130,
        divergenceThresholdPct: 0.1,
        divergenceThresholdMin: 15,
      }),
    ).toEqual({
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
      divergencePct: 0.05,
      riskFlags: [],
    });
  });

  it("falls back to screenshot yellow evidence when system timing is missing", () => {
    expect(
      resolveReportEvidence({
        systemDuration: null,
        screenshotDuration: 90,
        claimedDuration: 110,
      }),
    ).toMatchObject({
      settlementDuration: 90,
      timeSource: "screenshot",
      evidenceLevel: "yellow",
      riskFlags: ["missing_system_duration"],
    });
  });

  it("marks claimed-only reports as red evidence", () => {
    expect(
      resolveReportEvidence({
        systemDuration: null,
        screenshotDuration: null,
        claimedDuration: 75,
      }),
    ).toMatchObject({
      settlementDuration: 75,
      timeSource: "claimed",
      evidenceLevel: "red",
      riskFlags: ["missing_system_duration", "missing_screenshot_duration"],
    });
  });
});
