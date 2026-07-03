import { describe, expect, it } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import type { AgentOutput } from "./contracts";
import {
  attributeProjectRoiGap,
  attributeStreamerShowRate,
  buildRoiAttributionAgentOutput,
  buildShowRateAttributionAgentOutput,
} from "./xingyao-attribution-engine";
import { buildXingyaoFeatureStore } from "./xingyao-feature-store";
import {
  createInput,
  createProjectSlice,
  createStreamerSlice,
} from "./xingyao-test-fixtures";

describe("attributeProjectRoiGap", () => {
  it("ranks broadcast shortfall first and locates streamer/account/timeslot offenders", () => {
    const store = buildXingyaoFeatureStore(createInput());
    const attribution = attributeProjectRoiGap({ store, projectId: "p-1" });

    expect(attribution).not.toBeNull();
    expect(attribution?.healthy).toBe(false);
    expect(attribution?.roiGapBps).toBe(2_000);
    expect(attribution?.primaryCause).toBe("broadcast_shortfall");

    const broadcast = attribution?.causes.find(
      (cause) => cause.key === "broadcast_shortfall",
    );
    expect(broadcast?.scoreBps).toBe(3_333);
    expect(broadcast?.offenders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "streamer", id: "s-1" }),
        expect.objectContaining({ kind: "timeslot", id: "p-1:20" }),
      ]),
    );

    const traffic = attribution?.causes.find(
      (cause) => cause.key === "account_traffic_decline",
    );
    expect(traffic?.scoreBps).toBe(2_000);
    expect(traffic?.offenders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "account", id: "a-1" }),
      ]),
    );
  });

  it("locates weak-conversion streamers against the org median", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        projects: [createProjectSlice({ conversionGmvCents: 80_000 })],
        streamers: [
          createStreamerSlice({
            id: "s-a",
            name: "转化弱",
            viewership: 1_000,
            conversionGmvCents: 10_000,
          }),
          createStreamerSlice({
            id: "s-b",
            name: "转化强",
            viewership: 1_000,
            conversionGmvCents: 30_000,
          }),
        ],
      }),
    );
    const attribution = attributeProjectRoiGap({ store, projectId: "p-1" });
    const weakConversion = attribution?.causes.find(
      (cause) => cause.key === "weak_conversion",
    );

    expect(weakConversion?.scoreBps).toBe(5_000);
    expect(weakConversion?.offenders).toEqual([
      expect.objectContaining({ kind: "streamer", id: "s-a" }),
    ]);
  });

  it("reports a healthy project without a primary cause", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        projects: [createProjectSlice({ receivableCents: 700_000 })],
      }),
    );
    const attribution = attributeProjectRoiGap({ store, projectId: "p-1" });

    expect(attribution?.healthy).toBe(true);
    expect(attribution?.primaryCause).toBeNull();
  });

  it("returns null for unknown projects", () => {
    const store = buildXingyaoFeatureStore(createInput());
    expect(attributeProjectRoiGap({ store, projectId: "missing" })).toBeNull();
  });
});

describe("buildRoiAttributionAgentOutput", () => {
  it("keeps digits inside facts and requires human approval on every proposal", () => {
    const store = buildXingyaoFeatureStore(createInput());
    const attribution = attributeProjectRoiGap({ store, projectId: "p-1" });
    const result = buildRoiAttributionAgentOutput(attribution!);

    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.output.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTool: "xingyao_feature_store",
          sourceId: "p-1:roiGapBps",
        }),
      ]),
    );
    expect(result.output.findings[0].summary).toContain("开播率不足");
    expect(result.output.recommendations.length).toBeGreaterThan(0);
    expectNoNumbersOutsideFacts(result.output);
  });

  it("recommends holding course for healthy projects", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        projects: [createProjectSlice({ receivableCents: 700_000 })],
      }),
    );
    const attribution = attributeProjectRoiGap({ store, projectId: "p-1" });
    const result = buildRoiAttributionAgentOutput(attribution!);

    expect(result.output.findings[0].summary).toContain("达标");
    expect(result.validation.valid).toBe(true);
    expectNoNumbersOutsideFacts(result.output);
  });
});

describe("attributeStreamerShowRate", () => {
  it("ranks the absence pattern as the primary cause for the fixture streamer", () => {
    const store = buildXingyaoFeatureStore(createInput());
    const attribution = attributeStreamerShowRate({ store, streamerId: "s-1" });

    expect(attribution?.healthy).toBe(false);
    expect(attribution?.primaryCause).toBe("absence_pattern");
    expect(attribution?.causes.map((cause) => cause.key)).toEqual([
      "absence_pattern",
      "admission_test_gap",
      "training_gap",
      "schedule_mismatch",
    ]);
    const absence = attribution?.causes[0];
    expect(absence?.scoreBps).toBe(8_500);
    expect(absence?.detail).toContain("周三");
  });

  it("treats a fully attending streamer as healthy", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        streamers: [
          createStreamerSlice({
            startedSessions: 10,
            absenceCount30d: 0,
            consecutiveAbsences: 0,
            recentAbsenceDates: [],
          }),
        ],
      }),
    );
    const attribution = attributeStreamerShowRate({ store, streamerId: "s-1" });
    expect(attribution?.healthy).toBe(true);
    expect(attribution?.primaryCause).toBeNull();
  });
});

describe("buildShowRateAttributionAgentOutput", () => {
  it("emits digit-free findings with fully sourced evidence", () => {
    const store = buildXingyaoFeatureStore(createInput());
    const attribution = attributeStreamerShowRate({ store, streamerId: "s-1" });
    const result = buildShowRateAttributionAgentOutput(attribution!);

    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.output.findings[0].summary).toContain("历史缺勤规律");
    expect(
      result.output.recommendations.every(
        (recommendation) => recommendation.requiresHumanApproval === true,
      ),
    ).toBe(true);
    expectNoNumbersOutsideFacts(result.output);
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
