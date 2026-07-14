import { describe, expect, it } from "vitest";

import {
  buildCustomRuleReportExecutionContext,
  buildCustomRulePeriodAggregates,
} from "./custom-rule-execution-context";

describe("buildCustomRuleReportExecutionContext", () => {
  it("maps persisted source rows into typed report variables without implicit defaults", () => {
    const context = buildCustomRuleReportExecutionContext({
      businessTimezone: "America/Los_Angeles",
      businessTimezoneConfirmed: true,
      report: {
        id: "report-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        systemDurationMinutes: 45,
        screenshotDurationMinutes: 30,
        settlementDurationMinutes: 40,
        viewers: 123,
        evidenceLevel: "green",
        timeSource: "system",
        liveStartedAt: "2026-07-13T06:30:00.000Z",
        approvedAt: "2026-07-13T09:00:00.000Z",
      },
      projectStreamer: {
        id: "ps-1",
        streamerId: "streamer-1",
        streamerSource: "douyin",
        collaborationId: "collab-1",
        hourlyRateYuan: 80.5,
        baseSalaryYuan: 1000,
        cpsRateBps: 1234,
      },
    });

    expect(context.variables).toMatchObject({
      project_id: { type: "string", value: "project-1" },
      streamer_id: { type: "string", value: "streamer-1" },
      system_minutes: { type: "integer", value: 45 },
      screenshot_minutes: { type: "integer", value: 30 },
      settlement_minutes: { type: "integer", value: 40 },
      base_hourly_rate: { type: "money_cents", amountCents: 8050 },
      base_salary: { type: "money_cents", amountCents: 100000 },
      cps_rate: { type: "rate_bps", rateBps: 1234 },
      views: { type: "integer", value: 123 },
      weekday: { type: "integer", value: 7 },
      hour_of_day: { type: "integer", value: 23 },
      collaboration_id: { type: "string", value: "collab-1" },
      streamer_source: { type: "string", value: "douyin" },
    });
    expect(context.variables).not.toHaveProperty("gift_amount");
    expect(context.sourceSnapshot).toMatchObject({
      reportId: "report-1",
      projectStreamerId: "ps-1",
      businessTimezone: "America/Los_Angeles",
    });
  });

  it("rejects unsafe counts and unconfirmed timezones", () => {
    expect(() =>
      buildCustomRuleReportExecutionContext({
        businessTimezone: "Asia/Shanghai",
        businessTimezoneConfirmed: false,
        report: {
          id: "report-1",
          projectId: "project-1",
          streamerId: "streamer-1",
          viewers: 1,
          liveStartedAt: "2026-07-13T06:30:00.000Z",
        },
        projectStreamer: null,
      }),
    ).toThrow("confirmed IANA business timezone");

    expect(() =>
      buildCustomRuleReportExecutionContext({
        businessTimezone: "Asia/Shanghai",
        businessTimezoneConfirmed: true,
        report: {
          id: "report-1",
          projectId: "project-1",
          streamerId: "streamer-1",
          viewers: Number.MAX_SAFE_INTEGER + 1,
        },
        projectStreamer: null,
      }),
    ).toThrow("safe integer");
  });
});

describe("buildCustomRulePeriodAggregates", () => {
  it("computes aggregate variables from approved source reports only", () => {
    const aggregate = buildCustomRulePeriodAggregates({
      scope: "payable",
      projectId: "project-1",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      approvedReports: [
        {
          id: "report-2",
          approved: true,
          systemDurationMinutes: 20,
          settlementDurationMinutes: 15,
          salesAmountCents: 2000,
          ordersCount: 2,
          evidenceLevel: "yellow",
        },
        {
          id: "report-1",
          approved: true,
          systemDurationMinutes: 10,
          settlementDurationMinutes: 10,
          salesAmountCents: 1000,
          ordersCount: 1,
          evidenceLevel: "red",
        },
        {
          id: "report-ignored",
          approved: false,
          systemDurationMinutes: 999,
          settlementDurationMinutes: 999,
          salesAmountCents: 999,
          ordersCount: 999,
          evidenceLevel: "green",
        },
      ],
    });

    expect(aggregate.variables).toMatchObject({
      period_system_minutes: { type: "integer", value: 30 },
      period_settlement_minutes: { type: "integer", value: 25 },
      period_sales_amount: { type: "money_cents", amountCents: 3000 },
      period_orders_count: { type: "integer", value: 3 },
      period_report_count: { type: "integer", value: 2 },
      red_evidence_count: { type: "integer", value: 1 },
      yellow_evidence_count: { type: "integer", value: 1 },
    });
    expect(aggregate.sourceReportIds).toEqual(["report-1", "report-2"]);
  });

  it("rejects unsafe aggregate inputs before they can cancel each other out", () => {
    expect(() =>
      buildCustomRulePeriodAggregates({
        scope: "payable",
        projectId: "project-1",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
        approvedReports: [
          {
            id: "unsafe-positive",
            approved: true,
            salesAmountCents: Number.MAX_SAFE_INTEGER + 1,
          },
          {
            id: "unsafe-negative",
            approved: true,
            salesAmountCents: -(Number.MAX_SAFE_INTEGER + 1),
          },
        ],
      }),
    ).toThrow("safe integer");
  });
});
