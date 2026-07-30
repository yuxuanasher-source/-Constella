import { describe, expect, it, vi } from "vitest";

import { defaultAdmissionRubric } from "./contracts";
import {
  recordAdmissionEvaluation,
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "./evaluation-service";

function createFakeClient({
  checkpointRows = [],
}: {
  checkpointRows?: Array<Record<string, unknown>>;
} = {}) {
  const inserts = {
    admission_review_evaluations: [] as Record<string, unknown>[],
    admission_review_checkpoint_results: [] as Record<string, unknown>[],
  };

  const client = {
    inserts,
    from(table: string) {
      if (table === "admission_review_checkpoints") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({ data: checkpointRows, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "admission_review_evaluations") {
        return {
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                inserts.admission_review_evaluations.push(payload);
                return {
                  data: {
                    id: "evaluation-1",
                    created_at: "2026-07-03T10:00:00.000Z",
                    ...payload,
                  },
                  error: null,
                };
              },
            }),
          }),
        };
      }
      if (table === "admission_review_checkpoint_results") {
        return {
          insert: async (payload: Record<string, unknown>[]) => {
            inserts.admission_review_checkpoint_results.push(...payload);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return client as unknown as AdmissionReviewClient & {
    inserts: typeof inserts;
  };
}

describe("resolveAdmissionRubric", () => {
  it("passes cancellation to the rubric PostgREST request", async () => {
    const signal = new AbortController().signal;
    const response = Promise.resolve({ data: [], error: null });
    const abortSignal = vi.fn(() => response);
    const query = {
      then: response.then.bind(response),
      abortSignal,
    };
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => query,
            }),
          }),
        }),
      }),
    } as unknown as AdmissionReviewClient;

    await resolveAdmissionRubric({
      client,
      organizationId: "org-1",
      signal,
    });

    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("falls back to the built-in default rubric", async () => {
    const rubric = await resolveAdmissionRubric({
      client: createFakeClient(),
      organizationId: "org-1",
    });

    expect(rubric.source).toBe("default");
    expect(rubric.rubricVersion).toBe(1);
    expect(rubric.checkpoints.length).toBeGreaterThan(0);
  });

  it("uses only the latest organization rubric version", async () => {
    const rubric = await resolveAdmissionRubric({
      client: createFakeClient({
        checkpointRows: [
          {
            rubric_version: 3,
            key: "compliance_violation",
            label: "违规内容",
            description: "",
            severity: "hard_block",
            applicable_stage: "both",
            weight: 3,
            active: true,
          },
          {
            rubric_version: 3,
            key: "script_fit_v3",
            label: "话术贴合",
            description: "",
            severity: "soft",
            applicable_stage: "mcn_first",
            weight: 2,
            active: true,
          },
          {
            rubric_version: 2,
            key: "legacy_checkpoint",
            label: "旧版卡点",
            description: "",
            severity: "soft",
            applicable_stage: "both",
            weight: 1,
            active: true,
          },
        ],
      }),
      organizationId: "org-1",
    });

    expect(rubric.source).toBe("organization");
    expect(rubric.rubricVersion).toBe(3);
    expect(rubric.checkpoints.map((c) => c.key)).toEqual([
      "compliance_violation",
      "script_fit_v3",
    ]);
  });
});

describe("recordAdmissionEvaluation", () => {
  const rubric = defaultAdmissionRubric();

  it("passes cancellation to evaluation and checkpoint-result writes", async () => {
    const signal = new AbortController().signal;
    const evaluationResponse = Promise.resolve({
      data: {
        id: "evaluation-1",
        organization_id: "org-1",
        application_id: "application-1",
        submission_id: "submission-1",
        stage: "vendor_second",
        rubric_version: 1,
        decision: "rejected",
        decision_confidence: null,
        reviewer_id: null,
        vendor_review_id: "vendor-review-1",
        ai_invocation_id: null,
        note: "不采用",
        note_source: "human",
        created_at: "2026-07-03T10:00:00.000Z",
      },
      error: null,
    });
    const resultResponse = Promise.resolve({ error: null });
    const evaluationAbortSignal = vi.fn(() => evaluationResponse);
    const resultAbortSignal = vi.fn(() => resultResponse);
    const client = {
      from(table: string) {
        if (table === "admission_review_evaluations") {
          return {
            insert: () => ({
              select: () => ({
                single: () => ({
                  then: evaluationResponse.then.bind(evaluationResponse),
                  abortSignal: evaluationAbortSignal,
                }),
              }),
            }),
          };
        }
        return {
          insert: () => ({
            then: resultResponse.then.bind(resultResponse),
            abortSignal: resultAbortSignal,
          }),
        };
      },
    } as unknown as AdmissionReviewClient;

    await recordAdmissionEvaluation({
      client,
      rubric,
      signal,
      input: {
        organizationId: "org-1",
        applicationId: "application-1",
        submissionId: "submission-1",
        stage: "vendor_second",
        decision: "rejected",
        vendorReviewId: "vendor-review-1",
        note: "不采用",
        reasonCodes: ["script_fit"],
      },
    });

    expect(evaluationAbortSignal).toHaveBeenCalledWith(signal);
    expect(resultAbortSignal).toHaveBeenCalledWith(signal);
  });

  it("persists the evaluation with reason codes as fail results", async () => {
    const client = createFakeClient();

    const record = await recordAdmissionEvaluation({
      client,
      rubric,
      input: {
        organizationId: "org-1",
        applicationId: "application-1",
        submissionId: "submission-1",
        stage: "mcn_first",
        decision: "rejected",
        reviewerId: "user-1",
        note: "话术不贴卖点，画质模糊",
        noteSource: "human",
        reasonCodes: ["script_fit", "media_quality"],
      },
    });

    expect(record.id).toBe("evaluation-1");
    expect(record.rubricVersion).toBe(1);
    expect(client.inserts.admission_review_evaluations[0]).toMatchObject({
      stage: "mcn_first",
      decision: "rejected",
      note_source: "human",
      rubric_version: 1,
    });
    expect(client.inserts.admission_review_checkpoint_results).toEqual([
      expect.objectContaining({
        evaluation_id: "evaluation-1",
        checkpoint_key: "script_fit",
        verdict: "fail",
      }),
      expect.objectContaining({
        checkpoint_key: "media_quality",
        verdict: "fail",
      }),
    ]);
  });

  it("merges explicit checkpoint results with reason codes, explicit wins", async () => {
    const client = createFakeClient();

    await recordAdmissionEvaluation({
      client,
      rubric,
      input: {
        organizationId: "org-1",
        applicationId: "application-1",
        submissionId: "submission-1",
        stage: "mcn_first",
        decision: "needs_changes",
        checkpointResults: [
          { checkpointKey: "script_fit", verdict: "fail", note: "缺卖点" },
          { checkpointKey: "opening_hook", verdict: "pass" },
        ],
        reasonCodes: ["script_fit", "media_quality"],
      },
    });

    const results = client.inserts.admission_review_checkpoint_results;
    expect(results).toHaveLength(3);
    expect(
      results.find((r) => r.checkpoint_key === "script_fit"),
    ).toMatchObject({ verdict: "fail", note: "缺卖点" });
    expect(
      results.find((r) => r.checkpoint_key === "opening_hook"),
    ).toMatchObject({ verdict: "pass" });
  });

  it("blocks approving decisions when a hard-block checkpoint failed", async () => {
    const client = createFakeClient();

    await expect(
      recordAdmissionEvaluation({
        client,
        rubric,
        input: {
          organizationId: "org-1",
          applicationId: "application-1",
          submissionId: "submission-1",
          stage: "mcn_first",
          decision: "approved",
          checkpointResults: [
            { checkpointKey: "compliance_violation", verdict: "fail" },
          ],
        },
      }),
    ).rejects.toThrow(/Hard-block checkpoints failed/);
    expect(client.inserts.admission_review_evaluations).toHaveLength(0);
  });

  it("rejects unknown reason codes for the stage", async () => {
    const client = createFakeClient();

    await expect(
      recordAdmissionEvaluation({
        client,
        rubric,
        input: {
          organizationId: "org-1",
          applicationId: "application-1",
          submissionId: "submission-1",
          stage: "vendor_second",
          decision: "rejected",
          // media_unusable 仅适用一审，不是二审合法理由码。
          reasonCodes: ["media_unusable"],
        },
      }),
    ).rejects.toThrow(/Unknown admission reason code/);
  });
});
