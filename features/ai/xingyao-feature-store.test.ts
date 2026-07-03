import { describe, expect, it } from "vitest";

import {
  buildXingyaoFeatureStore,
  clampBps,
  rateBps,
  trendBps,
} from "./xingyao-feature-store";
import { createInput, createStreamerSlice } from "./xingyao-test-fixtures";

describe("xingyao feature store helpers", () => {
  it("computes rate in bps and degrades on missing denominator", () => {
    expect(rateBps(12, 20)).toBe(6000);
    expect(rateBps(5, 0)).toBe(0);
    expect(rateBps(Number.NaN, 10)).toBe(0);
  });

  it("treats missing baseline as flat trend instead of fake decline", () => {
    expect(trendBps(8000, 10000)).toBe(8000);
    expect(trendBps(12000, 10000)).toBe(12000);
    expect(trendBps(500, 0)).toBe(10000);
  });

  it("clamps bps values into the 0-10000 range", () => {
    expect(clampBps(-100)).toBe(0);
    expect(clampBps(25000)).toBe(10000);
    expect(clampBps(Number.NaN)).toBe(0);
  });
});

describe("buildXingyaoFeatureStore", () => {
  it("derives project ROI, execution and traffic features", () => {
    const store = buildXingyaoFeatureStore(createInput());
    const project = store.projects[0];

    expect(project.totalCostCents).toBe(500_000);
    expect(project.roiBps).toBe(10_000);
    expect(project.targetRoiBpsResolved).toBe(12_000);
    expect(project.roiGapBps).toBe(2_000);
    expect(project.broadcastRateBps).toBe(6_000);
    expect(project.trafficTrendBps).toBe(8_000);
    expect(project.paidCostShareBps).toBe(1_600);
    expect(project.conversionCentsPerThousandViews).toBe(25_000);
  });

  it("derives streamer show-rate, proxies and absence weekday pattern", () => {
    const store = buildXingyaoFeatureStore(createInput());
    const streamer = store.streamers[0];

    expect(streamer.showRateBps).toBe(5_000);
    expect(streamer.previousShowRateBps).toBe(9_000);
    expect(streamer.scheduleMismatchRateBps).toBe(2_000);
    // 2026-06-24 与 2026-07-01 均为周三（UTC weekday = 3）。
    expect(streamer.absenceWeekdayPattern).toBe(3);
  });

  it("keeps single absences out of the weekday pattern", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        streamers: [
          createStreamerSlice({
            recentAbsenceDates: ["2026-06-24", "2026-07-02"],
          }),
        ],
      }),
    );
    expect(store.streamers[0].absenceWeekdayPattern).toBeNull();
  });

  it("computes benchmarks from populated entities only", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        streamers: [
          createStreamerSlice({
            id: "s-a",
            viewership: 1000,
            conversionGmvCents: 10_000,
          }),
          createStreamerSlice({
            id: "s-b",
            viewership: 1000,
            conversionGmvCents: 30_000,
          }),
          createStreamerSlice({
            id: "s-c",
            viewership: 0,
            conversionGmvCents: 0,
          }),
        ],
      }),
    );
    expect(store.benchmarks.medianConversionCentsPerThousandViews).toBe(20_000);
  });

  it("marks missing modules in coverage and missingData", () => {
    const store = buildXingyaoFeatureStore(
      createInput({ accounts: [], settlements: [], knowledge: undefined }),
    );

    expect(store.coverage).toEqual(
      expect.arrayContaining([
        { module: "accounts", available: false },
        { module: "settlements", available: false },
        { module: "projects", available: true },
      ]),
    );
    expect(store.missingData.join(" ")).toContain("账号库数据");
    expect(store.missingData.join(" ")).toContain("结算回款数据");
  });

  it("computes settlement amount share against the org total", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        settlements: [
          {
            id: "b-1",
            counterparty: "厂家甲",
            amountCents: 300_000,
            dueInDays: -3,
            counterpartyPastOverdueRateBps: 0,
            disputed: false,
          },
          {
            id: "b-2",
            counterparty: "厂家乙",
            amountCents: 100_000,
            dueInDays: 10,
            counterpartyPastOverdueRateBps: 0,
            disputed: false,
          },
        ],
      }),
    );

    expect(store.settlements[0].overdueDays).toBe(3);
    expect(store.settlements[0].amountShareBps).toBe(7_500);
    expect(store.settlements[1].overdueDays).toBe(0);
    expect(store.settlements[1].amountShareBps).toBe(2_500);
  });
});
