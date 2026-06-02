import { describe, expect, it } from "vitest";

import {
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
