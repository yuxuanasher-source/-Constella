import { describe, expect, it } from "vitest";

import { runAdmissionReviewMetrics } from "./metrics-job";

const actor = {
  userId: "runner-user",
  name: "Admission Runner",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

function createMetricsClient({
  signals = [] as Array<Record<string, unknown>>,
} = {}) {
  const upserts: Array<Record<string, unknown>[]> = [];
  const draftInserts: Array<Record<string, unknown>> = [];

  return {
    upserts,
    draftInserts,
    from(table: string) {
      if (table === "admission_review_signals") {
        return {
          select: () => ({
            eq: () => ({
              gte: async () => ({ data: signals, error: null }),
            }),
          }),
        };
      }
      if (table === "admission_review_metrics") {
        return {
          upsert: async (payload: Record<string, unknown>[]) => {
            upserts.push(payload);
            return { error: null };
          },
        };
      }
      if (table === "ai_drafts") {
        return {
          insert: (payload: Record<string, unknown>) => ({
            select: async () => {
              draftInserts.push(payload);
              return {
                data: [{ id: `draft-${draftInserts.length}` }],
                error: null,
              };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function falsePassSignals(count: number, misses: number) {
  return Array.from({ length: count }, (_, index) => ({
    signal_kind: "ai_vs_mcn",
    payload: {
      aiEvaluationId: `ai-${index}`,
      mcnEvaluationId: `mcn-${index}`,
      aiDecision: "approved",
      aiConfidence: "high",
      mcnDecision: index < misses ? "rejected" : "approved",
      overallAgreement: index >= misses,
      checkpointDeltas: [
        {
          key: "compliance_violation",
          ai: "pass",
          mcn: index < misses ? "fail" : "pass",
          match: index >= misses,
        },
      ],
    },
  }));
}

describe("runAdmissionReviewMetrics", () => {
  it("materializes metrics and creates calibration proposal drafts", async () => {
    const client = createMetricsClient({
      signals: falsePassSignals(40, 4),
    });

    const result = await runAdmissionReviewMetrics({
      client,
      actor,
      windowDays: 28,
      now: () => new Date("2026-07-03T12:00:00.000Z"),
    });

    expect(result.periodEnd).toBe("2026-07-03");
    expect(result.periodStart).toBe("2026-06-05");
    expect(result.metrics.length).toBeGreaterThan(0);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].checkpointKey).toBe("compliance_violation");
    expect(result.draftIds).toEqual(["draft-1"]);

    const fake = client as unknown as {
      upserts: Array<Record<string, unknown>[]>;
      draftInserts: Array<Record<string, unknown>>;
    };
    expect(fake.upserts[0][0]).toMatchObject({
      organization_id: "org-1",
      period_start: "2026-06-05",
      period_end: "2026-07-03",
    });
    expect(fake.draftInserts[0]).toMatchObject({
      draft_type: "admission_calibration",
      status: "pending",
    });
  });

  it("returns empty results without signals and creates no drafts", async () => {
    const client = createMetricsClient();

    const result = await runAdmissionReviewMetrics({
      client,
      actor,
      now: () => new Date("2026-07-03T12:00:00.000Z"),
    });

    expect(result.metrics).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.draftIds).toEqual([]);
    expect(
      (client as unknown as { upserts: unknown[] }).upserts,
    ).toHaveLength(0);
  });
});
