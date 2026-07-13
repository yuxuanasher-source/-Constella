import {
  buildSettlementGroupMembershipSnapshot,
  type SettlementGroupMembershipSnapshot,
} from "./custom-rule-groups";
import type {
  CustomRuleExecutionGrain,
  CustomRuleExecutionUnit,
  CustomRuleScope,
  TypedRuntimeValue,
} from "./custom-rule-types";

export type CustomRuleMembershipTimestampSource =
  | "live_tasks.system_started_at"
  | "live_tasks.planned_start_at"
  | "live_reports.created_at";

export type CustomRuleExecutionPlanningReport = Readonly<{
  id: string;
  projectId: string;
  projectStreamerId?: string;
  streamerId?: string;
  approved?: boolean;
  eligible?: boolean;
  liveTaskSystemStartedAt?: string;
  plannedStartAt?: string;
  createdAt: string;
  variables?: Record<string, TypedRuntimeValue>;
}>;

export type CustomRuleEffectiveRuleVersion = Readonly<{
  id: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
}>;

export type CustomRuleExecutionPlanningInput = Readonly<{
  scope: CustomRuleScope;
  grain: CustomRuleExecutionGrain;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  sourceReports: readonly CustomRuleExecutionPlanningReport[];
  ruleVersions: readonly CustomRuleEffectiveRuleVersion[];
  membershipSnapshots: readonly SettlementGroupMembershipSnapshot[];
}>;

export type PlannedCustomRuleExecutionUnit = CustomRuleExecutionUnit & {
  ruleVersionId: string;
  membershipTimestamp: string;
  membershipTimestampSource: CustomRuleMembershipTimestampSource;
};

export type CustomRuleExecutionPlanningResult =
  | { ok: true; units: PlannedCustomRuleExecutionUnit[] }
  | {
      ok: false;
      code: "SPLIT_PERIOD_REQUIRED";
      message: string;
      splitAt: string[];
    };

type PreparedReport = Readonly<{
  report: CustomRuleExecutionPlanningReport;
  timestamp: string;
  timestampSource: CustomRuleMembershipTimestampSource;
  ruleVersionId: string;
  membershipSnapshot: SettlementGroupMembershipSnapshot;
}>;

export function planCustomRuleExecutionUnits(
  input: CustomRuleExecutionPlanningInput,
): CustomRuleExecutionPlanningResult {
  if (isOncePerPeriodGrain(input.grain)) {
    const splitAt = ruleBoundariesInsideRequestedPeriod(input);
    if (splitAt.length > 0) {
      return {
        ok: false,
        code: "SPLIT_PERIOD_REQUIRED",
        message:
          `${input.grain} execution crosses rule-version boundaries; ` +
          "split the requested period",
        splitAt,
      };
    }
  }

  const reports = input.sourceReports
    .filter((report) => report.projectId === input.projectId)
    .filter((report) => report.approved !== false && report.eligible !== false)
    .map((report) => prepareReport(input, report));

  const units =
    input.grain === "report"
      ? reports.map((report) => reportUnit(input, report))
      : input.grain === "project_streamer_period"
        ? aggregateUnits(input, reports, "project_streamer_period")
        : aggregateUnits(input, reports, input.grain);

  return {
    ok: true,
    units: units.sort(comparePlannedUnits),
  };
}

function comparePlannedUnits(
  left: PlannedCustomRuleExecutionUnit,
  right: PlannedCustomRuleExecutionUnit,
): number {
  if (
    left.grain === "project_streamer_period" &&
    right.grain === "project_streamer_period"
  ) {
    return (
      left.membershipTimestamp.localeCompare(right.membershipTimestamp) ||
      left.key.localeCompare(right.key)
    );
  }
  return left.key.localeCompare(right.key);
}

function reportUnit(
  input: CustomRuleExecutionPlanningInput,
  prepared: PreparedReport,
): PlannedCustomRuleExecutionUnit {
  const { report } = prepared;
  return {
    key: `report:${input.projectId}:${report.id}`,
    grain: "report",
    projectId: input.projectId,
    ...(report.projectStreamerId
      ? { projectStreamerId: report.projectStreamerId }
      : {}),
    ...(report.streamerId ? { streamerId: report.streamerId } : {}),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    sourceReportIds: [report.id],
    membershipSnapshot: prepared.membershipSnapshot,
    variables: { ...(report.variables ?? {}) },
    ruleVersionId: prepared.ruleVersionId,
    membershipTimestamp: prepared.timestamp,
    membershipTimestampSource: prepared.timestampSource,
  };
}

function aggregateUnits(
  input: CustomRuleExecutionPlanningInput,
  reports: PreparedReport[],
  grain: Exclude<CustomRuleExecutionGrain, "report">,
): PlannedCustomRuleExecutionUnit[] {
  const groups = new Map<string, PreparedReport[]>();
  for (const prepared of reports) {
    const key =
      grain === "project_streamer_period"
        ? [
            prepared.report.projectStreamerId ?? "",
            prepared.ruleVersionId,
            prepared.membershipSnapshot.snapshotHash,
          ].join("\u001f")
        : [prepared.ruleVersionId].join("\u001f");
    const existing = groups.get(key);
    if (existing) {
      existing.push(prepared);
    } else {
      groups.set(key, [prepared]);
    }
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    if (!first) {
      throw new Error("execution group must not be empty");
    }
    const sourceReportIds = group.map((item) => item.report.id).sort();
    const projectStreamerId = first.report.projectStreamerId;
    const key =
      grain === "project_streamer_period"
        ? `${grain}:${input.projectId}:${projectStreamerId ?? "project"}:` +
          `${first.ruleVersionId}:${first.membershipSnapshot.snapshotHash}`
        : `${grain}:${input.projectId}:${first.ruleVersionId}`;
    return {
      key,
      grain,
      projectId: input.projectId,
      ...(projectStreamerId ? { projectStreamerId } : {}),
      ...(first.report.streamerId ? { streamerId: first.report.streamerId } : {}),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      sourceReportIds,
      membershipSnapshot: first.membershipSnapshot,
      variables: {},
      ruleVersionId: first.ruleVersionId,
      membershipTimestamp: first.timestamp,
      membershipTimestampSource: first.timestampSource,
    };
  });
}

function prepareReport(
  input: CustomRuleExecutionPlanningInput,
  report: CustomRuleExecutionPlanningReport,
): PreparedReport {
  const timestampSelection = membershipTimestamp(report);
  const ruleVersion = effectiveRuleVersion(input.ruleVersions, timestampSelection.timestamp);
  return {
    report,
    timestamp: timestampSelection.timestamp,
    timestampSource: timestampSelection.source,
    ruleVersionId: ruleVersion.id,
    membershipSnapshot: membershipSnapshotFor(
      input.membershipSnapshots,
      report.projectStreamerId,
      timestampSelection.timestamp,
    ),
  };
}

function membershipTimestamp(report: CustomRuleExecutionPlanningReport): {
  timestamp: string;
  source: CustomRuleMembershipTimestampSource;
} {
  if (report.liveTaskSystemStartedAt) {
    return {
      timestamp: isoTimestamp(report.liveTaskSystemStartedAt),
      source: "live_tasks.system_started_at",
    };
  }
  if (report.plannedStartAt) {
    return {
      timestamp: isoTimestamp(report.plannedStartAt),
      source: "live_tasks.planned_start_at",
    };
  }
  return {
    timestamp: isoTimestamp(report.createdAt),
    source: "live_reports.created_at",
  };
}

function effectiveRuleVersion(
  versions: readonly CustomRuleEffectiveRuleVersion[],
  timestamp: string,
): CustomRuleEffectiveRuleVersion {
  const version = [...versions]
    .filter(
      (candidate) =>
        candidate.effectiveFrom <= timestamp &&
        (candidate.effectiveUntil === null || timestamp < candidate.effectiveUntil),
    )
    .sort(
      (left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom) ||
        left.id.localeCompare(right.id),
    )[0];
  if (!version) {
    throw new Error("no effective custom rule version for execution timestamp");
  }
  return version;
}

function membershipSnapshotFor(
  snapshots: readonly SettlementGroupMembershipSnapshot[],
  projectStreamerId: string | undefined,
  timestamp: string,
): SettlementGroupMembershipSnapshot {
  if (!projectStreamerId) {
    return buildSettlementGroupMembershipSnapshot({
      projectStreamerId: "",
      effectiveAt: timestamp,
      groups: [],
    });
  }
  const snapshot = snapshots
    .filter(
      (candidate) =>
        candidate.projectStreamerId === projectStreamerId &&
        candidate.effectiveAt <= timestamp,
    )
    .sort(
      (left, right) =>
        right.effectiveAt.localeCompare(left.effectiveAt) ||
        left.snapshotHash.localeCompare(right.snapshotHash),
    )[0];
  return (
    snapshot ??
    buildSettlementGroupMembershipSnapshot({
      projectStreamerId,
      effectiveAt: timestamp,
      groups: [],
    })
  );
}

function ruleBoundariesInsideRequestedPeriod(
  input: CustomRuleExecutionPlanningInput,
): string[] {
  return [
    ...new Set(
      input.ruleVersions
        .map((version) => isoTimestamp(version.effectiveFrom))
        .filter(
          (effectiveFrom) =>
            input.periodStart < effectiveFrom && effectiveFrom < input.periodEnd,
        ),
    ),
  ].sort();
}

function isOncePerPeriodGrain(grain: CustomRuleExecutionGrain): boolean {
  return grain === "batch" || grain === "project_period";
}

function isoTimestamp(value: string): string {
  const timestamp = new Date(value).toISOString();
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error("execution timestamp must be valid");
  }
  return timestamp;
}
