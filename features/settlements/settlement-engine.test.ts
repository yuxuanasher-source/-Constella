import { describe, expect, it } from "vitest";

import {
  calculateCpsManualAmount,
  calculateSettlementItem,
  summarizeEvidence,
} from "./settlement-engine";

const baseReport = {
  id: "report-1",
  settlementDuration: 120,
  timeSource: "system" as const,
  evidenceLevel: "green" as const,
};

describe("settlement engine", () => {
  it("calculates CPT from frozen settlement duration and hourly rate", () => {
    const item = calculateSettlementItem({
      report: baseReport,
      rule: {
        settlementMethod: "cpt",
        hourlyRate: 80,
        baseSalary: 0,
      },
    });

    expect(item).toMatchObject({
      computedAmount: 160,
      manualAmount: 0,
      adjustmentAmount: 0,
      evidenceLevel: "green",
    });
    expect(item.evidenceSnapshot).toEqual({
      liveReportId: "report-1",
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
    });
  });

  it("calculates base salary and base salary plus CPT without manual revenue", () => {
    expect(
      calculateSettlementItem({
        report: baseReport,
        rule: {
          settlementMethod: "base_salary",
          hourlyRate: 80,
          baseSalary: 5000,
        },
      }).computedAmount,
    ).toBe(5000);

    expect(
      calculateSettlementItem({
        report: baseReport,
        rule: {
          settlementMethod: "base_salary_cpt",
          hourlyRate: 80,
          baseSalary: 5000,
        },
      }).computedAmount,
    ).toBe(5160);
  });

  it("does not calculate CPA CPS or gift revenue automatically", () => {
    for (const settlementMethod of ["cpa", "cps", "gift"] as const) {
      const item = calculateSettlementItem({
        report: baseReport,
        rule: {
          settlementMethod,
          hourlyRate: 80,
          baseSalary: 5000,
        },
        manualAmount: 88,
      });

      expect(item).toMatchObject({
        computedAmount: 0,
        manualAmount: 88,
      });
    }
  });

  it("calculates CPS manual amount from sales amount and basis points", () => {
    expect(
      calculateCpsManualAmount({ salesAmount: 12000, cpsRateBps: 1500 }),
    ).toBe(1800);
    expect(
      calculateCpsManualAmount({ salesAmount: 999.99, cpsRateBps: 250 }),
    ).toBe(25);
  });

  it("calculates tiered CPT across duration brackets", () => {
    // 0–120 min @ ¥60/h, 120–240 min @ ¥90/h, 240+ @ ¥120/h.
    // Duration 300 min = 2h@60 + 2h@90 + 1h@120 = 120 + 180 + 120 = 420.
    const item = calculateSettlementItem({
      report: { ...baseReport, settlementDuration: 300 },
      rule: {
        settlementMethod: "cpt",
        hourlyTiers: [
          { uptoMinutes: 120, ratePerHour: 60 },
          { uptoMinutes: 240, ratePerHour: 90 },
          { uptoMinutes: null, ratePerHour: 120 },
        ],
      },
    });

    expect(item.computedAmount).toBe(420);
    expect(item.breakdown.baseAmount).toBe(420);
  });

  it("ignores tiered CPT when evidence is not green system time", () => {
    const item = calculateSettlementItem({
      report: { ...baseReport, timeSource: "claimed" },
      rule: {
        settlementMethod: "cpt",
        hourlyTiers: [{ uptoMinutes: null, ratePerHour: 100 }],
      },
    });

    expect(item.computedAmount).toBe(0);
  });

  it("applies a percentage penalty for red evidence", () => {
    const item = calculateSettlementItem({
      report: { ...baseReport, evidenceLevel: "green" },
      rule: {
        settlementMethod: "cpt",
        hourlyRate: 80,
        penalties: [
          {
            key: "red",
            trigger: "red_evidence",
            mode: "percent",
            value: 5000,
            label: "红证据扣半",
          },
        ],
      },
    });
    // green report -> no penalty
    expect(item.computedAmount).toBe(160);
    expect(item.breakdown.penalties).toHaveLength(0);

    const penalized = calculateSettlementItem({
      report: { ...baseReport, evidenceLevel: "red", timeSource: "system" },
      rule: {
        settlementMethod: "base_salary",
        baseSalary: 200,
        penalties: [
          { key: "red", trigger: "red_evidence", mode: "percent", value: 5000 },
        ],
      },
    });
    // base salary 200, red evidence -> 50% penalty -> 100
    expect(penalized.computedAmount).toBe(100);
    expect(penalized.breakdown.penaltyAmount).toBe(100);
  });

  it("applies a fixed penalty for non-system time", () => {
    const item = calculateSettlementItem({
      report: { ...baseReport, timeSource: "claimed", evidenceLevel: "green" },
      rule: {
        settlementMethod: "base_salary",
        baseSalary: 300,
        penalties: [
          {
            key: "manual-time",
            trigger: "non_system_time",
            mode: "fixed",
            value: 50,
          },
        ],
      },
    });

    expect(item.computedAmount).toBe(250);
    expect(item.breakdown.penalties[0]).toMatchObject({
      trigger: "non_system_time",
      amount: 50,
    });
  });

  it("clamps the computed amount to the configured floor and cap", () => {
    const floored = calculateSettlementItem({
      report: baseReport,
      rule: {
        settlementMethod: "cpt",
        hourlyRate: 10,
        floorAmount: 100,
      },
    });
    // 2h @ ¥10 = 20, floored up to 100
    expect(floored.computedAmount).toBe(100);
    expect(floored.breakdown.floorApplied).toBe(true);

    const capped = calculateSettlementItem({
      report: baseReport,
      rule: {
        settlementMethod: "cpt",
        hourlyRate: 500,
        capAmount: 300,
      },
    });
    // 2h @ ¥500 = 1000, capped down to 300
    expect(capped.computedAmount).toBe(300);
    expect(capped.breakdown.capApplied).toBe(true);
  });

  it("summarizes evidence levels for batch audit snapshots", () => {
    const summary = summarizeEvidence([
      { evidenceLevel: "green" },
      { evidenceLevel: "green" },
      { evidenceLevel: "yellow" },
      { evidenceLevel: "red" },
      { evidenceLevel: null },
    ]);

    expect(summary).toEqual({
      green: 2,
      yellow: 1,
      red: 1,
      unknown: 1,
    });
  });
});
