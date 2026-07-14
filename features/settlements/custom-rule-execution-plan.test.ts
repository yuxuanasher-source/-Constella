import { describe, expect, it } from "vitest";

import { buildSettlementGroupMembershipSnapshot } from "./custom-rule-groups";
import {
  planCustomRuleExecutionUnits,
  type CustomRuleExecutionPlanningInput,
} from "./custom-rule-execution-plan";

const PERIOD_START = "2026-07-01T00:00:00.000Z";
const PERIOD_END = "2026-08-01T00:00:00.000Z";

const membershipA = buildSettlementGroupMembershipSnapshot({
  projectStreamerId: "ps-a",
  effectiveAt: "2026-07-01T00:00:00.000Z",
  groups: [{ id: "g-a", name: "A", assignmentId: "asg-a" }],
});

const membershipB = buildSettlementGroupMembershipSnapshot({
  projectStreamerId: "ps-a",
  effectiveAt: "2026-07-16T00:00:00.000Z",
  groups: [{ id: "g-b", name: "B", assignmentId: "asg-b" }],
});

const defaultInput = (
  overrides: Partial<CustomRuleExecutionPlanningInput> = {},
): CustomRuleExecutionPlanningInput => ({
  scope: "payable",
  grain: "report",
  projectId: "project-1",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  sourceReports: [
    report({
      id: "r-2",
      projectStreamerId: "ps-b",
      streamerId: "streamer-b",
      createdAt: "2026-07-11T00:00:00.000Z",
    }),
    report({
      id: "r-1",
      projectStreamerId: "ps-a",
      streamerId: "streamer-a",
      liveTaskSystemStartedAt: "2026-07-02T01:00:00.000Z",
      plannedStartAt: "2026-07-03T01:00:00.000Z",
      createdAt: "2026-07-04T01:00:00.000Z",
    }),
  ],
  ruleVersions: [
    {
      id: "rule-v1",
      effectiveFrom: PERIOD_START,
      effectiveUntil: null,
    },
  ],
  membershipSnapshots: [
    membershipA,
    buildSettlementGroupMembershipSnapshot({
      projectStreamerId: "ps-b",
      effectiveAt: "2026-07-01T00:00:00.000Z",
      groups: [],
    }),
  ],
  ...overrides,
});

describe("planCustomRuleExecutionUnits", () => {
  it("plans report grain as one deterministic unit per approved eligible report", () => {
    const result = expectPlan(defaultInput());

    expect(result.units.map((unit) => unit.key)).toEqual([
      "report:project-1:r-1",
      "report:project-1:r-2",
    ]);
    expect(result.units.map((unit) => unit.sourceReportIds)).toEqual([
      ["r-1"],
      ["r-2"],
    ]);
    expect(result.units[0]).toMatchObject({
      grain: "report",
      projectId: "project-1",
      projectStreamerId: "ps-a",
      streamerId: "streamer-a",
      ruleVersionId: "rule-v1",
      membershipTimestamp: "2026-07-02T01:00:00.000Z",
      membershipTimestampSource: "live_tasks.system_started_at",
    });
  });

  it("plans one payable streamer-period unit per streamer and membership segment", () => {
    const result = expectPlan(
      defaultInput({
        grain: "project_streamer_period",
        sourceReports: [
          report({
            id: "r-late",
            projectStreamerId: "ps-a",
            streamerId: "streamer-a",
            createdAt: "2026-07-20T00:00:00.000Z",
          }),
          report({
            id: "r-early",
            projectStreamerId: "ps-a",
            streamerId: "streamer-a",
            createdAt: "2026-07-03T00:00:00.000Z",
          }),
        ],
        membershipSnapshots: [membershipB, membershipA],
      }),
    );

    expect(result.units.map((unit) => unit.key)).toEqual([
      "project_streamer_period:project-1:ps-a:rule-v1:" +
        membershipA.snapshotHash,
      "project_streamer_period:project-1:ps-a:rule-v1:" +
        membershipB.snapshotHash,
    ]);
    expect(result.units.map((unit) => unit.sourceReportIds)).toEqual([
      ["r-early"],
      ["r-late"],
    ]);
  });

  it("plans receivable batch and project period as once-per-period aggregate units", () => {
    const batch = expectPlan(
      defaultInput({ scope: "receivable", grain: "batch" }),
    );
    const projectPeriod = expectPlan(
      defaultInput({ scope: "receivable", grain: "project_period" }),
    );

    expect(batch.units).toHaveLength(1);
    expect(batch.units[0]).toMatchObject({
      key: "batch:project-1:rule-v1",
      sourceReportIds: ["r-1", "r-2"],
    });
    expect(projectPeriod.units).toHaveLength(1);
    expect(projectPeriod.units[0]).toMatchObject({
      key: "project_period:project-1:rule-v1",
      sourceReportIds: ["r-1", "r-2"],
    });
  });

  it("partitions report and streamer-period units at rule version boundaries", () => {
    const result = expectPlan(
      defaultInput({
        grain: "project_streamer_period",
        sourceReports: [
          report({
            id: "r-v2",
            projectStreamerId: "ps-a",
            streamerId: "streamer-a",
            createdAt: "2026-07-20T00:00:00.000Z",
          }),
          report({
            id: "r-v1",
            projectStreamerId: "ps-a",
            streamerId: "streamer-a",
            createdAt: "2026-07-03T00:00:00.000Z",
          }),
        ],
        ruleVersions: [
          {
            id: "rule-v2",
            effectiveFrom: "2026-07-15T00:00:00.000Z",
            effectiveUntil: null,
          },
          {
            id: "rule-v1",
            effectiveFrom: PERIOD_START,
            effectiveUntil: "2026-07-15T00:00:00.000Z",
          },
        ],
        membershipSnapshots: [membershipA],
      }),
    );

    expect(result.units.map((unit) => unit.ruleVersionId)).toEqual([
      "rule-v1",
      "rule-v2",
    ]);
    expect(result.units.map((unit) => unit.sourceReportIds)).toEqual([
      ["r-v1"],
      ["r-v2"],
    ]);
  });

  it("blocks batch and project-period grains when the requested period crosses a rule boundary", () => {
    const result = planCustomRuleExecutionUnits(
      defaultInput({
        grain: "batch",
        ruleVersions: [
          {
            id: "rule-v1",
            effectiveFrom: PERIOD_START,
            effectiveUntil: "2026-07-15T00:00:00.000Z",
          },
          {
            id: "rule-v2",
            effectiveFrom: "2026-07-15T00:00:00.000Z",
            effectiveUntil: null,
          },
        ],
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: "SPLIT_PERIOD_REQUIRED",
      message:
        "batch execution crosses rule-version boundaries; split the requested period",
      splitAt: ["2026-07-15T00:00:00.000Z"],
    });
  });

  it("chooses membership timestamps in task, planned, then report-created order", () => {
    const result = expectPlan(
      defaultInput({
        sourceReports: [
          report({
            id: "r-task",
            liveTaskSystemStartedAt: "2026-07-02T00:00:00.000Z",
            plannedStartAt: "2026-07-03T00:00:00.000Z",
            createdAt: "2026-07-04T00:00:00.000Z",
          }),
          report({
            id: "r-planned",
            plannedStartAt: "2026-07-05T00:00:00.000Z",
            createdAt: "2026-07-06T00:00:00.000Z",
          }),
          report({
            id: "r-created",
            createdAt: "2026-07-07T00:00:00.000Z",
          }),
        ],
      }),
    );

    expect(
      result.units.map((unit) => [
        unit.sourceReportIds[0],
        unit.membershipTimestamp,
        unit.membershipTimestampSource,
      ]),
    ).toEqual([
      ["r-created", "2026-07-07T00:00:00.000Z", "live_reports.created_at"],
      ["r-planned", "2026-07-05T00:00:00.000Z", "live_tasks.planned_start_at"],
      [
        "r-task",
        "2026-07-02T00:00:00.000Z",
        "live_tasks.system_started_at",
      ],
    ]);
  });

  it("is deterministic independent of source report input order", () => {
    const input = defaultInput({
      sourceReports: [
        report({ id: "r-c", createdAt: "2026-07-03T00:00:00.000Z" }),
        report({ id: "r-a", createdAt: "2026-07-01T00:00:00.000Z" }),
        report({ id: "r-b", createdAt: "2026-07-02T00:00:00.000Z" }),
      ],
    });
    const reversed = { ...input, sourceReports: [...input.sourceReports].reverse() };

    expect(expectPlan(input).units).toEqual(expectPlan(reversed).units);
  });

  it("uses deterministic aggregate metadata independent of source report input order", () => {
    const input = defaultInput({
      grain: "project_streamer_period",
      sourceReports: [
        report({
          id: "r-late",
          projectStreamerId: "ps-a",
          streamerId: "streamer-a",
          createdAt: "2026-07-20T00:00:00.000Z",
        }),
        report({
          id: "r-early",
          projectStreamerId: "ps-a",
          streamerId: "streamer-a",
          createdAt: "2026-07-10T00:00:00.000Z",
        }),
      ],
    });
    const reversed = {
      ...input,
      sourceReports: [...input.sourceReports].reverse(),
    };

    expect(expectPlan(input).units).toEqual(expectPlan(reversed).units);
    expect(expectPlan(input).units[0]).toMatchObject({
      membershipTimestamp: "2026-07-10T00:00:00.000Z",
      membershipTimestampSource: "live_reports.created_at",
    });
  });

  it("filters source reports outside the requested period", () => {
    const result = expectPlan(
      defaultInput({
        sourceReports: [
          report({ id: "before", createdAt: "2026-06-30T23:59:59.999Z" }),
          report({ id: "inside", createdAt: "2026-07-10T00:00:00.000Z" }),
          report({ id: "at-end", createdAt: PERIOD_END }),
        ],
      }),
    );

    expect(result.units.map((unit) => unit.sourceReportIds)).toEqual([
      ["inside"],
    ]);
  });

  it("normalizes period and version boundaries before comparison", () => {
    const result = planCustomRuleExecutionUnits(
      defaultInput({
        grain: "batch",
        periodStart: "2026-07-01",
        periodEnd: "2026-08-01",
        ruleVersions: [
          {
            id: "rule-v1",
            effectiveFrom: "2026-07-01T08:00:00+08:00",
            effectiveUntil: "2026-07-15T08:00:00+08:00",
          },
          {
            id: "rule-v2",
            effectiveFrom: "2026-07-15T08:00:00+08:00",
            effectiveUntil: null,
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      splitAt: ["2026-07-15T00:00:00.000Z"],
    });
  });
});

function expectPlan(input: CustomRuleExecutionPlanningInput) {
  const result = planCustomRuleExecutionUnits(input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.code);
  return result;
}

function report(
  overrides: Partial<CustomRuleExecutionPlanningInput["sourceReports"][number]>,
): CustomRuleExecutionPlanningInput["sourceReports"][number] {
  return {
    id: "r-1",
    projectId: "project-1",
    projectStreamerId: "ps-a",
    streamerId: "streamer-a",
    approved: true,
    eligible: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    variables: {},
    ...overrides,
  };
}
