import { describe, expect, it } from "vitest";

import type { recordAiInvocation } from "@/features/ai/invocation-ledger";

import { classifyPendingVendorRemarks } from "./vendor-classification-job";
import type { classifyVendorRemark } from "./remark-classifier";

const actor = {
  userId: "runner-user",
  name: "Admission Runner",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

function vendorReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "vendor-review-1",
    organization_id: "org-1",
    application_id: "application-1",
    recording_submission_id: "submission-1",
    decision: "rejected",
    remark: "话术不贴卖点",
    submitted_at: "2026-07-03T09:00:00.000Z",
    ...overrides,
  };
}

function createFakeClient({
  vendorReviews = [vendorReviewRow()],
  classifiedVendorReviewIds = [] as string[],
} = {}) {
  const inserts = {
    admission_review_evaluations: [] as Record<string, unknown>[],
    admission_review_checkpoint_results: [] as Record<string, unknown>[],
  };

  return {
    inserts,
    from(table: string) {
      if (table === "project_recording_vendor_reviews") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                neq: () => ({
                  order: () => ({
                    limit: async () => ({ data: vendorReviews, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "admission_review_evaluations") {
        return {
          select: () => ({
            in: async () => ({
              data: classifiedVendorReviewIds.map((id) => ({
                vendor_review_id: id,
              })),
              error: null,
            }),
          }),
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                inserts.admission_review_evaluations.push(payload);
                return {
                  data: {
                    id: `evaluation-${inserts.admission_review_evaluations.length}`,
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
      if (table === "admission_review_checkpoints") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({ data: [], error: null }),
              }),
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
  } as never;
}

const classifyStub = (async ({ remark }: { remark: string }) => ({
  reasonCodes: remark.includes("话术") ? ["script_fit"] : [],
  confidence: "high" as const,
  source: "llm" as const,
  providerName: "deepseek" as const,
})) as typeof classifyVendorRemark;

function collectInvocations(records: Array<Record<string, unknown>>) {
  return (({ input }: { input: Record<string, unknown> }) => {
    records.push(input);
    return Promise.resolve(String(input.id));
  }) as unknown as typeof recordAiInvocation;
}

describe("classifyPendingVendorRemarks", () => {
  it("classifies pending vendor remarks into vendor_second evaluations", async () => {
    const client = createFakeClient();
    const invocations: Array<Record<string, unknown>> = [];

    const result = await classifyPendingVendorRemarks({
      client,
      actor,
      classify: classifyStub,
      recordInvocation: collectInvocations(invocations),
    });

    expect(result.processed).toBe(1);
    expect(result.classified[0]).toMatchObject({
      vendorReviewId: "vendor-review-1",
      reasonCodes: ["script_fit"],
      source: "llm",
    });
    expect(result.failures).toEqual([]);

    const fakeClient = client as unknown as {
      inserts: Record<string, Record<string, unknown>[]>;
    };
    expect(fakeClient.inserts.admission_review_evaluations[0]).toMatchObject({
      stage: "vendor_second",
      decision: "rejected",
      note: "话术不贴卖点",
      note_source: "llm_classified",
      vendor_review_id: "vendor-review-1",
    });
    expect(
      fakeClient.inserts.admission_review_checkpoint_results[0],
    ).toMatchObject({ checkpoint_key: "script_fit", verdict: "fail" });
    expect(invocations[0]).toMatchObject({
      scene: "admission.classify_vendor_remark",
      providerName: "deepseek",
    });
  });

  it("skips vendor reviews that already have an evaluation", async () => {
    const client = createFakeClient({
      classifiedVendorReviewIds: ["vendor-review-1"],
    });

    const result = await classifyPendingVendorRemarks({
      client,
      actor,
      classify: classifyStub,
      recordInvocation: collectInvocations([]),
    });

    expect(result.processed).toBe(0);
    expect(result.classified).toEqual([]);
  });

  it("collects per-review failures without aborting the batch", async () => {
    const client = createFakeClient({
      vendorReviews: [
        vendorReviewRow(),
        vendorReviewRow({
          id: "vendor-review-2",
          recording_submission_id: "submission-2",
          remark: "画质太差",
        }),
      ],
    });

    const failingClassify = (async ({ remark }: { remark: string }) => {
      if (remark.includes("画质")) {
        throw new Error("classifier exploded");
      }
      return {
        reasonCodes: ["script_fit"],
        confidence: "high" as const,
        source: "llm" as const,
        providerName: "deepseek" as const,
      };
    }) as typeof classifyVendorRemark;

    const result = await classifyPendingVendorRemarks({
      client,
      actor,
      classify: failingClassify,
      recordInvocation: collectInvocations([]),
    });

    expect(result.processed).toBe(1);
    expect(result.failures).toEqual([
      {
        vendorReviewId: "vendor-review-2",
        errorSummary: "classifier exploded",
      },
    ]);
  });
});
