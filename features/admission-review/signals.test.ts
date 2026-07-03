import { describe, expect, it } from "vitest";

import { recordAiVsMcnSignal, recordMcnVsVendorSignal } from "./signals";

function evaluationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evaluation-1",
    application_id: "application-1",
    submission_id: "submission-1",
    stage: "mcn_first",
    decision: "approved",
    decision_confidence: null,
    created_at: "2026-07-03T10:00:00.000Z",
    admission_review_checkpoint_results: [],
    ...overrides,
  };
}

function createSignalsClient(evaluations: Array<Record<string, unknown>>) {
  const upserts: Array<Record<string, unknown>> = [];
  return {
    upserts,
    from(table: string) {
      if (table === "admission_review_evaluations") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: async () => ({ data: evaluations, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "admission_review_signals") {
        return {
          upsert: async (payload: Record<string, unknown>) => {
            upserts.push(payload);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe("recordAiVsMcnSignal", () => {
  it("computes per-checkpoint deltas and overall agreement", async () => {
    const client = createSignalsClient([
      evaluationRow({
        id: "evaluation-mcn",
        stage: "mcn_first",
        decision: "rejected",
        created_at: "2026-07-03T11:00:00.000Z",
        admission_review_checkpoint_results: [
          { checkpoint_key: "script_fit", verdict: "fail" },
          { checkpoint_key: "media_quality", verdict: "pass" },
        ],
      }),
      evaluationRow({
        id: "evaluation-ai",
        stage: "ai_pre_review",
        decision: "rejected",
        decision_confidence: "high",
        created_at: "2026-07-03T10:30:00.000Z",
        admission_review_checkpoint_results: [
          { checkpoint_key: "script_fit", verdict: "fail" },
          { checkpoint_key: "media_quality", verdict: "fail" },
        ],
      }),
    ]);

    const payload = await recordAiVsMcnSignal({
      client,
      organizationId: "org-1",
      submissionId: "submission-1",
    });

    expect(payload).toMatchObject({
      aiEvaluationId: "evaluation-ai",
      mcnEvaluationId: "evaluation-mcn",
      aiDecision: "rejected",
      mcnDecision: "rejected",
      overallAgreement: true,
    });
    expect(payload?.checkpointDeltas).toEqual([
      { key: "media_quality", ai: "fail", mcn: "pass", match: false },
      { key: "script_fit", ai: "fail", mcn: "fail", match: true },
    ]);

    const fake = client as unknown as {
      upserts: Array<Record<string, unknown>>;
    };
    expect(fake.upserts[0]).toMatchObject({
      organization_id: "org-1",
      submission_id: "submission-1",
      signal_kind: "ai_vs_mcn",
    });
  });

  it("treats manual_review pre-reviews as non-agreement", async () => {
    const client = createSignalsClient([
      evaluationRow({
        id: "evaluation-mcn",
        stage: "mcn_first",
        decision: "approved",
      }),
      evaluationRow({
        id: "evaluation-ai",
        stage: "ai_pre_review",
        decision: "manual_review",
      }),
    ]);

    const payload = await recordAiVsMcnSignal({
      client,
      organizationId: "org-1",
      submissionId: "submission-1",
    });

    expect(payload?.overallAgreement).toBe(false);
  });

  it("returns null when the pre-review side is missing", async () => {
    const client = createSignalsClient([
      evaluationRow({ stage: "mcn_first" }),
    ]);

    await expect(
      recordAiVsMcnSignal({
        client,
        organizationId: "org-1",
        submissionId: "submission-1",
      }),
    ).resolves.toBeNull();
    expect(
      (client as unknown as { upserts: unknown[] }).upserts,
    ).toHaveLength(0);
  });
});

describe("recordMcnVsVendorSignal", () => {
  it("flags MCN misses when the vendor rejects an approved recording", async () => {
    const client = createSignalsClient([
      evaluationRow({
        id: "evaluation-vendor",
        stage: "vendor_second",
        decision: "rejected",
        created_at: "2026-07-03T12:00:00.000Z",
        admission_review_checkpoint_results: [
          { checkpoint_key: "script_fit", verdict: "fail" },
        ],
      }),
      evaluationRow({
        id: "evaluation-mcn",
        stage: "mcn_first",
        decision: "approved",
        created_at: "2026-07-03T11:00:00.000Z",
      }),
    ]);

    const payload = await recordMcnVsVendorSignal({
      client,
      organizationId: "org-1",
      submissionId: "submission-1",
    });

    expect(payload).toMatchObject({
      mcnDecision: "approved",
      vendorDecision: "rejected",
      vendorReasonCodes: ["script_fit"],
      mcnMiss: true,
    });
  });

  it("records agreement rows too so metrics have denominators", async () => {
    const client = createSignalsClient([
      evaluationRow({
        id: "evaluation-vendor",
        stage: "vendor_second",
        decision: "selected",
      }),
      evaluationRow({
        id: "evaluation-mcn",
        stage: "mcn_first",
        decision: "approved",
      }),
    ]);

    const payload = await recordMcnVsVendorSignal({
      client,
      organizationId: "org-1",
      submissionId: "submission-1",
    });

    expect(payload?.mcnMiss).toBe(false);
    expect(
      (client as unknown as { upserts: unknown[] }).upserts,
    ).toHaveLength(1);
  });

  it("returns null when either stage is missing", async () => {
    const client = createSignalsClient([
      evaluationRow({ stage: "vendor_second", decision: "rejected" }),
    ]);

    await expect(
      recordMcnVsVendorSignal({
        client,
        organizationId: "org-1",
        submissionId: "submission-1",
      }),
    ).resolves.toBeNull();
  });
});
