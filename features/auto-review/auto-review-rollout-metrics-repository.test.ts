import { describe, expect, it } from "vitest";

import {
  buildAutoReviewRolloutMetricsFromAuditRows,
  listAutoReviewRolloutMetricRows,
  type AutoReviewRolloutMetricAuditRow,
} from "./auto-review-rollout-metrics-repository";

describe("buildAutoReviewRolloutMetricsFromAuditRows", () => {
  it("correlates shadow decisions with final human live-report reviews", () => {
    const snapshot = buildAutoReviewRolloutMetricsFromAuditRows({
      config: passingConfig(),
      rows: [
        humanReviewRow({
          id: "human-2",
          objectId: "report-2",
          action: "reject",
          status: "rejected",
          createdAt: "2026-06-04T10:04:00.000Z",
        }),
        humanReviewRow({
          id: "human-1",
          objectId: "report-1",
          action: "approve",
          status: "approved",
          createdAt: "2026-06-04T10:03:00.000Z",
        }),
        shadowRow({
          id: "shadow-2",
          objectId: "report-2",
          decision: "auto_pass_candidate",
          createdAt: "2026-06-04T10:02:00.000Z",
        }),
        shadowRow({
          id: "shadow-1",
          objectId: "report-1",
          decision: "auto_pass_candidate",
          createdAt: "2026-06-04T10:01:00.000Z",
        }),
      ],
    });

    expect(snapshot.gateInput).toMatchObject({
      shadowSampleCount: 2,
      shadowFalseAcceptRateBps: 5000,
    });
    expect(snapshot.summary).toMatchObject({
      shadowAutoPassReviewedCount: 2,
      shadowFalseAcceptCount: 1,
    });
  });

  it("uses the most recent human review row for the same report", () => {
    const snapshot = buildAutoReviewRolloutMetricsFromAuditRows({
      config: passingConfig(),
      rows: [
        humanReviewRow({
          id: "human-latest",
          objectId: "report-1",
          action: "approve",
          status: "approved",
          createdAt: "2026-06-04T10:05:00.000Z",
        }),
        humanReviewRow({
          id: "human-old",
          objectId: "report-1",
          action: "reject",
          status: "rejected",
          createdAt: "2026-06-04T10:01:00.000Z",
        }),
        shadowRow({
          id: "shadow-1",
          objectId: "report-1",
          decision: "auto_pass_candidate",
          createdAt: "2026-06-04T10:00:00.000Z",
        }),
      ],
    });

    expect(snapshot.gateInput.shadowFalseAcceptRateBps).toBe(0);
    expect(snapshot.summary.shadowFalseAcceptCount).toBe(0);
  });

  it("maps active audit outcome metadata into audit error rate", () => {
    const snapshot = buildAutoReviewRolloutMetricsFromAuditRows({
      config: passingConfig(),
      rows: [
        activeAuditSampleRow({
          id: "sample-1",
          expectedDecision: "approve",
          actualDecision: "reject",
        }),
        activeAuditSampleRow({
          id: "sample-2",
          expectedDecision: "approve",
          actualDecision: "approve",
        }),
      ],
    });

    expect(snapshot.gateInput.auditSampleCount).toBe(2);
    expect(snapshot.gateInput.auditErrorRateBps).toBe(5000);
    expect(snapshot.summary.auditErrorCount).toBe(1);
  });

  it("queries scoped successful live-report audit rows with a safe limit", async () => {
    const { client, calls } = createClient([]);

    await listAutoReviewRolloutMetricRows(client, {
      organizationId: "org-1",
      config: passingConfig(),
      limit: 999,
    });

    expect(calls).toContainEqual(["from", ["audit_logs"]]);
    expect(calls).toContainEqual(["eq", ["organization_id", "org-1"]]);
    expect(calls).toContainEqual([
      "in",
      ["module", ["auto_review", "live_report"]],
    ]);
    expect(calls).toContainEqual(["eq", ["object_type", "live_report"]]);
    expect(calls).toContainEqual(["eq", ["result", "success"]]);
    expect(calls).toContainEqual([
      "order",
      ["created_at", { ascending: false }],
    ]);
    expect(calls).toContainEqual(["limit", [500]]);
  });
});

function passingConfig() {
  return {
    targetMode: "active" as const,
    killSwitchEnabled: false,
    minimumShadowSampleCount: 1,
    maximumFalseAcceptRateBps: 100,
    minimumAuditSampleCount: 1,
    maximumAuditErrorRateBps: 100,
    explicitActiveRequest: true,
  };
}

function shadowRow(input: {
  id: string;
  objectId: string;
  decision: "auto_pass_candidate" | "manual_review" | "disabled";
  createdAt: string;
}): AutoReviewRolloutMetricAuditRow {
  return auditRow({
    id: input.id,
    module: "auto_review",
    action: "approve",
    objectId: input.objectId,
    after: {
      mode: "shadow",
      decision: input.decision,
    },
    createdAt: input.createdAt,
  });
}

function humanReviewRow(input: {
  id: string;
  objectId: string;
  action: "approve" | "reject";
  status: "approved" | "rejected" | "need_more";
  createdAt: string;
}): AutoReviewRolloutMetricAuditRow {
  return auditRow({
    id: input.id,
    module: "live_report",
    action: input.action,
    objectId: input.objectId,
    after: {
      status: input.status,
    },
    createdAt: input.createdAt,
  });
}

function activeAuditSampleRow(input: {
  id: string;
  expectedDecision: "approve" | "reject" | "needs_changes";
  actualDecision: "approve" | "reject" | "needs_changes";
}): AutoReviewRolloutMetricAuditRow {
  return auditRow({
    id: input.id,
    module: "auto_review",
    action: "approve",
    objectId: "report-sample",
    after: {
      mode: "active",
      auditOutcome: {
        expectedDecision: input.expectedDecision,
        actualDecision: input.actualDecision,
      },
    },
    createdAt: "2026-06-04T10:00:00.000Z",
  });
}

function auditRow(input: {
  id: string;
  module: "auto_review" | "live_report";
  action: "approve" | "reject";
  objectId: string;
  after: Record<string, unknown>;
  createdAt: string;
}): AutoReviewRolloutMetricAuditRow {
  return {
    id: input.id,
    organization_id: "org-1",
    action: input.action,
    module: input.module,
    object_type: "live_report",
    object_id: input.objectId,
    after_json: input.after,
    result: "success",
    created_at: input.createdAt,
  };
}

function createClient(rows: AutoReviewRolloutMetricAuditRow[]) {
  const calls: Array<[string, unknown[]]> = [];
  const query = {
    select: (columns: string) => {
      calls.push(["select", [columns]]);
      return query;
    },
    eq: (column: string, value: unknown) => {
      calls.push(["eq", [column, value]]);
      return query;
    },
    in: (column: string, values: unknown[]) => {
      calls.push(["in", [column, values]]);
      return query;
    },
    order: (column: string, options: { ascending: boolean }) => {
      calls.push(["order", [column, options]]);
      return query;
    },
    limit: async (count: number) => {
      calls.push(["limit", [count]]);
      return { data: rows, error: null };
    },
  };

  return {
    client: {
      from: (table: "audit_logs") => {
        calls.push(["from", [table]]);
        return query;
      },
    },
    calls,
  };
}
