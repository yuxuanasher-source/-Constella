import { createHash } from "node:crypto";

import type {
  CustomRuleCompositionMode,
  MaterialRiskCode,
} from "./custom-rule-types";

export type SettlementGroupMembershipSnapshot = {
  projectStreamerId: string;
  effectiveAt: string;
  groups: Array<{ id: string; name: string; assignmentId: string }>;
  snapshotHash: string;
};

export type SettlementGroupAssignmentInterval = Readonly<{
  id: string;
  projectStreamerId: string;
  groupId: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
}>;

export type SettlementGroupAssignmentChangeInput = Readonly<{
  projectStreamerId: string;
  nextGroupId: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  reason: string;
  existingAssignments: readonly SettlementGroupAssignmentInterval[];
  lockedBatchEffectiveTimes: readonly string[];
}>;

export type SettlementGroupAssignmentChangePlan = Readonly<{
  closeAssignmentIds: string[];
  insert: {
    projectStreamerId: string;
    groupId: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
  };
}>;

export type SettlementGroupScopedRule = Readonly<{
  id: string;
  targetGroupId: string;
  priority: number;
  compositionMode: Extract<
    CustomRuleCompositionMode,
    "replace" | "add" | "multiply" | "clamp" | "emit_items" | "check"
  >;
  projectStreamerIds: readonly string[];
  status: "active" | "pending_review";
}>;

export type SettlementGroupRuleConflictAnalysis = Readonly<{
  blocking: boolean;
  blockingCodes: string[];
  orderedRuleIds: string[];
  materialRiskCodes: MaterialRiskCode[];
  requiresOwnerApproval: boolean;
}>;

export type SettlementGroupSimulationFreshnessInput = Readonly<{
  immutableSimulationId: string;
  status: "draft" | "pending_review" | "changes_requested" | "active" | "archived";
  effectiveFrom: string | null;
  now: string;
  simulationGroupSnapshotHash: string;
  currentGroupSnapshotHash: string;
}>;

export type SettlementGroupSimulationFreshness = Readonly<{
  immutableSimulationId: string;
  stale: boolean;
  staleReason:
    | "fresh"
    | "group_snapshot_mismatch"
    | "historical_immutable";
}>;

export function buildSettlementGroupMembershipSnapshot(input: {
  projectStreamerId: string;
  effectiveAt: string;
  groups: Array<{ id: string; name: string; assignmentId: string }>;
}): SettlementGroupMembershipSnapshot {
  const groups = [...input.groups].sort(compareGroupSnapshotEntries);
  const hashPayload = {
    projectStreamerId: input.projectStreamerId,
    effectiveAt: input.effectiveAt,
    groups,
  };
  return {
    ...hashPayload,
    snapshotHash: sha256(canonicalJson(hashPayload)),
  };
}

export function validateSettlementGroupAssignmentChange(
  input: SettlementGroupAssignmentChangeInput,
): SettlementGroupAssignmentChangePlan {
  const effectiveFrom = requireTimestamp(input.effectiveFrom, "effective time");
  const effectiveUntil =
    input.effectiveUntil === undefined || input.effectiveUntil === null
      ? null
      : requireTimestamp(input.effectiveUntil, "effective until");
  if (effectiveUntil !== null && effectiveUntil <= effectiveFrom) {
    throw new Error("effective until must be after the effective time");
  }
  if (input.reason.trim().length === 0) {
    throw new Error("assignment reason is required");
  }
  for (const lockedTime of input.lockedBatchEffectiveTimes) {
    if (effectiveFrom <= lockedTime) {
      throw new Error(
        "assignment change cannot rewrite locked batch historical effective time",
      );
    }
  }

  const closeAssignmentIds: string[] = [];
  for (const assignment of input.existingAssignments) {
    if (assignment.projectStreamerId !== input.projectStreamerId) continue;
    if (assignment.groupId !== input.nextGroupId) continue;
    if (intervalContains(assignment, effectiveFrom)) {
      closeAssignmentIds.push(assignment.id);
      continue;
    }
    if (
      intervalsOverlap(
        assignment.effectiveFrom,
        assignment.effectiveUntil,
        effectiveFrom,
        effectiveUntil,
      )
    ) {
      throw new Error("group assignment interval overlap");
    }
  }

  closeAssignmentIds.sort();
  return {
    closeAssignmentIds,
    insert: {
      projectStreamerId: input.projectStreamerId,
      groupId: input.nextGroupId,
      effectiveFrom,
      effectiveUntil,
    },
  };
}

export function deriveSettlementGroupSimulationFreshness(
  input: SettlementGroupSimulationFreshnessInput,
): SettlementGroupSimulationFreshness {
  if (isHistoricalImmutable(input)) {
    return {
      immutableSimulationId: input.immutableSimulationId,
      stale: false,
      staleReason: "historical_immutable",
    };
  }
  const stale =
    input.simulationGroupSnapshotHash !== input.currentGroupSnapshotHash;
  return {
    immutableSimulationId: input.immutableSimulationId,
    stale,
    staleReason: stale ? "group_snapshot_mismatch" : "fresh",
  };
}

export function determineSettlementPopulationCoverage(input: {
  joinedProjectStreamerIds: readonly string[];
  activeAssignments: readonly {
    projectStreamerId: string;
    groupId: string;
  }[];
}) {
  const assigned = new Set(
    input.activeAssignments.map((assignment) => assignment.projectStreamerId),
  );
  const joined = [...new Set(input.joinedProjectStreamerIds)].sort();
  const assignedProjectStreamerIds = joined.filter((id) => assigned.has(id));
  const unassignedProjectStreamerIds = joined.filter((id) => !assigned.has(id));
  return {
    assignedProjectStreamerIds,
    unassignedProjectStreamerIds,
    baseRuleCoveredProjectStreamerIds: [...unassignedProjectStreamerIds],
  };
}

export function validateSettlementGroupRuleActivationReadiness(input: {
  targetGroupId: string;
  assignedProjectStreamerIds: readonly string[];
  unassignedProjectStreamerIds: readonly string[];
  simulationPopulation: {
    assignedProjectStreamerIds: readonly string[];
    unassignedProjectStreamerIds: readonly string[];
    groupSnapshotHash: string;
  };
  currentGroupSnapshotHash: string;
}): void {
  void input.targetGroupId;
  if (
    input.simulationPopulation.groupSnapshotHash !==
    input.currentGroupSnapshotHash
  ) {
    throw new Error("group rule simulation is stale");
  }
  assertPopulationIncludes(
    input.simulationPopulation.assignedProjectStreamerIds,
    input.assignedProjectStreamerIds,
    "assigned",
  );
  assertPopulationIncludes(
    input.simulationPopulation.unassignedProjectStreamerIds,
    input.unassignedProjectStreamerIds,
    "unassigned",
  );
}

export function analyzeSettlementGroupRuleConflicts(
  rules: readonly SettlementGroupScopedRule[],
): SettlementGroupRuleConflictAnalysis {
  const orderedRules = [...rules].sort(
    (left, right) =>
      left.priority - right.priority || left.id.localeCompare(right.id),
  );
  const blockingCodes = new Set<string>();
  const materialRiskCodes = new Set<MaterialRiskCode>();

  for (let leftIndex = 0; leftIndex < orderedRules.length; leftIndex += 1) {
    const left = orderedRules[leftIndex];
    if (!left) continue;
    if (left.compositionMode === "replace") {
      materialRiskCodes.add("group_level_replace");
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < orderedRules.length;
      rightIndex += 1
    ) {
      const right = orderedRules[rightIndex];
      if (!right) continue;
      if (!overlapsPopulation(left, right)) continue;
      if (left.priority === right.priority) {
        blockingCodes.add("same_priority_overlap");
      }
      if (
        left.compositionMode === "replace" &&
        right.compositionMode === "replace"
      ) {
        blockingCodes.add("ambiguous_composition");
      }
    }
  }

  return {
    blocking: blockingCodes.size > 0,
    blockingCodes: [...blockingCodes].sort(),
    orderedRuleIds: orderedRules.map((rule) => rule.id),
    materialRiskCodes: [...materialRiskCodes],
    requiresOwnerApproval: materialRiskCodes.has("group_level_replace"),
  };
}

function compareGroupSnapshotEntries(
  left: { id: string; name: string; assignmentId: string },
  right: { id: string; name: string; assignmentId: string },
): number {
  return (
    left.id.localeCompare(right.id) ||
    left.assignmentId.localeCompare(right.assignmentId) ||
    left.name.localeCompare(right.name)
  );
}

function intervalContains(
  assignment: SettlementGroupAssignmentInterval,
  effectiveFrom: string,
): boolean {
  return (
    assignment.effectiveFrom < effectiveFrom &&
    (assignment.effectiveUntil === null ||
      effectiveFrom < assignment.effectiveUntil)
  );
}

function intervalsOverlap(
  leftFrom: string,
  leftUntil: string | null,
  rightFrom: string,
  rightUntil: string | null,
): boolean {
  return (
    leftFrom < (rightUntil ?? "9999-12-31T23:59:59.999Z") &&
    rightFrom < (leftUntil ?? "9999-12-31T23:59:59.999Z")
  );
}

function isHistoricalImmutable(
  input: SettlementGroupSimulationFreshnessInput,
): boolean {
  if (input.status === "active" || input.status === "archived") return true;
  if (input.effectiveFrom === null) return false;
  return requireTimestamp(input.effectiveFrom, "effective from") <=
    requireTimestamp(input.now, "now");
}

function overlapsPopulation(
  left: SettlementGroupScopedRule,
  right: SettlementGroupScopedRule,
): boolean {
  const rightIds = new Set(right.projectStreamerIds);
  return left.projectStreamerIds.some((id) => rightIds.has(id));
}

function assertPopulationIncludes(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const actualIds = new Set(actual);
  const missing = expected.filter((id) => !actualIds.has(id));
  if (missing.length > 0) {
    throw new Error(`simulation must include ${label} population`);
  }
}

function requireTimestamp(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return new Date(parsed).toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
