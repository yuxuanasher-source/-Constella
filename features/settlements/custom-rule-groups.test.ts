import { describe, expect, it } from "vitest";

import {
  analyzeSettlementGroupRuleConflicts,
  buildSettlementGroupMembershipSnapshot,
  determineSettlementPopulationCoverage,
  validateSettlementGroupAssignmentChange,
  validateSettlementGroupRuleActivationReadiness,
  type SettlementGroupAssignmentInterval,
  type SettlementGroupScopedRule,
} from "./custom-rule-groups";

describe("settlement group membership governance", () => {
  it("builds a deterministic membership snapshot and hash", () => {
    const snapshot = buildSettlementGroupMembershipSnapshot({
      projectStreamerId: "project-streamer-1",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      groups: [
        { id: "group-b", name: "Gold", assignmentId: "assignment-2" },
        { id: "group-a", name: "Silver", assignmentId: "assignment-1" },
      ],
    });

    expect(snapshot).toEqual({
      projectStreamerId: "project-streamer-1",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      groups: [
        { id: "group-a", name: "Silver", assignmentId: "assignment-1" },
        { id: "group-b", name: "Gold", assignmentId: "assignment-2" },
      ],
      snapshotHash:
        "eee268ab3caea8af12ff82c0a36fd1da31bfd2c2d2c99e3e416db42114595dfd",
    });
  });

  it("requires a reason and effective time when assigning a backfilled streamer", () => {
    expect(() =>
      validateSettlementGroupAssignmentChange({
        projectStreamerId: "project-streamer-1",
        nextGroupId: "group-1",
        effectiveFrom: "",
        reason: "Initial assignment.",
        existingAssignments: [],
        lockedBatchEffectiveTimes: [],
      }),
    ).toThrow("effective time");

    expect(() =>
      validateSettlementGroupAssignmentChange({
        projectStreamerId: "project-streamer-1",
        nextGroupId: "group-1",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "  ",
        existingAssignments: [],
        lockedBatchEffectiveTimes: [],
      }),
    ).toThrow("reason");
  });

  it("closes the previous active interval and inserts the next interval", () => {
    const existingAssignments: SettlementGroupAssignmentInterval[] = [
      {
        id: "assignment-1",
        projectStreamerId: "project-streamer-1",
        groupId: "group-1",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveUntil: null,
      },
    ];

    expect(
      validateSettlementGroupAssignmentChange({
        projectStreamerId: "project-streamer-1",
        nextGroupId: "group-2",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "Move streamer into the August rule group.",
        existingAssignments,
        lockedBatchEffectiveTimes: [],
      }),
    ).toEqual({
      closeAssignmentIds: ["assignment-1"],
      insert: {
        projectStreamerId: "project-streamer-1",
        groupId: "group-2",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveUntil: null,
      },
    });
  });

  it("blocks overlapping intervals for the same streamer and group", () => {
    expect(() =>
      validateSettlementGroupAssignmentChange({
        projectStreamerId: "project-streamer-1",
        nextGroupId: "group-1",
        effectiveFrom: "2026-07-15T00:00:00.000Z",
        reason: "Duplicate overlapping assignment.",
        existingAssignments: [
          {
            id: "assignment-1",
            projectStreamerId: "project-streamer-1",
            groupId: "group-1",
            effectiveFrom: "2026-07-01T00:00:00.000Z",
            effectiveUntil: "2026-08-01T00:00:00.000Z",
          },
        ],
        lockedBatchEffectiveTimes: [],
      }),
    ).toThrow("overlap");
  });

  it("allows multiple simultaneous groups when the group identities differ", () => {
    expect(
      validateSettlementGroupAssignmentChange({
        projectStreamerId: "project-streamer-1",
        nextGroupId: "group-2",
        effectiveFrom: "2026-07-15T00:00:00.000Z",
        reason: "Add a separate exception group.",
        existingAssignments: [
          {
            id: "assignment-1",
            projectStreamerId: "project-streamer-1",
            groupId: "group-1",
            effectiveFrom: "2026-07-01T00:00:00.000Z",
            effectiveUntil: "2026-08-01T00:00:00.000Z",
          },
        ],
        lockedBatchEffectiveTimes: [],
      }).insert.groupId,
    ).toBe("group-2");
  });

  it("rejects assignment changes that rewrite locked batch history", () => {
    expect(() =>
      validateSettlementGroupAssignmentChange({
        projectStreamerId: "project-streamer-1",
        nextGroupId: "group-2",
        effectiveFrom: "2026-07-10T00:00:00.000Z",
        reason: "Rewrite before locked settlement evidence.",
        existingAssignments: [
          {
            id: "assignment-1",
            projectStreamerId: "project-streamer-1",
            groupId: "group-1",
            effectiveFrom: "2026-07-01T00:00:00.000Z",
            effectiveUntil: null,
          },
        ],
        lockedBatchEffectiveTimes: ["2026-07-20T00:00:00.000Z"],
      }),
    ).toThrow("locked batch");
  });

  it("lists joined project streamers without active assignments as base-rule covered", () => {
    expect(
      determineSettlementPopulationCoverage({
        joinedProjectStreamerIds: [
          "project-streamer-1",
          "project-streamer-2",
          "project-streamer-3",
        ],
        activeAssignments: [
          { projectStreamerId: "project-streamer-2", groupId: "group-1" },
        ],
      }),
    ).toEqual({
      assignedProjectStreamerIds: ["project-streamer-2"],
      unassignedProjectStreamerIds: [
        "project-streamer-1",
        "project-streamer-3",
      ],
      baseRuleCoveredProjectStreamerIds: [
        "project-streamer-1",
        "project-streamer-3",
      ],
    });
  });

  it("requires group-rule simulation to include assigned and unassigned populations", () => {
    expect(() =>
      validateSettlementGroupRuleActivationReadiness({
        targetGroupId: "group-1",
        assignedProjectStreamerIds: ["project-streamer-1"],
        unassignedProjectStreamerIds: ["project-streamer-2"],
        simulationPopulation: {
          assignedProjectStreamerIds: ["project-streamer-1"],
          unassignedProjectStreamerIds: [],
          groupSnapshotHash: "a".repeat(64),
        },
        currentGroupSnapshotHash: "a".repeat(64),
      }),
    ).toThrow("unassigned");
  });

  it("marks future pending simulations stale by changing the group snapshot hash", () => {
    expect(() =>
      validateSettlementGroupRuleActivationReadiness({
        targetGroupId: "group-1",
        assignedProjectStreamerIds: ["project-streamer-1"],
        unassignedProjectStreamerIds: ["project-streamer-2"],
        simulationPopulation: {
          assignedProjectStreamerIds: ["project-streamer-1"],
          unassignedProjectStreamerIds: ["project-streamer-2"],
          groupSnapshotHash: "a".repeat(64),
        },
        currentGroupSnapshotHash: "b".repeat(64),
      }),
    ).toThrow("stale");
  });

  it("sorts compatible group rule layers by ascending priority", () => {
    const rules: SettlementGroupScopedRule[] = [
      groupRule("rule-2", 20, "add", ["project-streamer-1"]),
      groupRule("rule-1", 10, "add", ["project-streamer-1"]),
    ];

    expect(analyzeSettlementGroupRuleConflicts(rules)).toMatchObject({
      blocking: false,
      orderedRuleIds: ["rule-1", "rule-2"],
    });
  });

  it("blocks same-priority overlapping populations and ambiguous composition", () => {
    const samePriority = analyzeSettlementGroupRuleConflicts([
      groupRule("rule-1", 10, "add", ["project-streamer-1"]),
      groupRule("rule-2", 10, "multiply", ["project-streamer-1"]),
    ]);
    const ambiguous = analyzeSettlementGroupRuleConflicts([
      groupRule("rule-1", 10, "replace", ["project-streamer-1"]),
      groupRule("rule-2", 20, "replace", ["project-streamer-1"]),
    ]);

    expect(samePriority).toMatchObject({
      blocking: true,
      blockingCodes: ["same_priority_overlap"],
    });
    expect(ambiguous).toMatchObject({
      blocking: true,
      blockingCodes: ["ambiguous_composition"],
    });
  });

  it("treats group replace as material risk that requires owner approval", () => {
    expect(
      analyzeSettlementGroupRuleConflicts([
        groupRule("rule-1", 10, "replace", ["project-streamer-1"]),
      ]),
    ).toMatchObject({
      blocking: false,
      materialRiskCodes: ["group_level_replace"],
      requiresOwnerApproval: true,
    });
  });
});

function groupRule(
  id: string,
  priority: number,
  compositionMode: SettlementGroupScopedRule["compositionMode"],
  projectStreamerIds: string[],
): SettlementGroupScopedRule {
  return {
    id,
    targetGroupId: "group-1",
    priority,
    compositionMode,
    projectStreamerIds,
    status: "pending_review",
  };
}
