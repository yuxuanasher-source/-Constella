import { describe, expect, it } from "vitest";

import { aggregateStreamerAdmissionStats } from "./streamer-admission-stats";

describe("aggregateStreamerAdmissionStats", () => {
  it("returns an explicit empty aggregate when no vendor review exists", () => {
    expect(
      aggregateStreamerAdmissionStats({
        applications: [],
        organizationId: "org-1",
      }),
    ).toEqual({
      vendorPassRateBps: null,
      rejectionReasonHistogram: {},
      evaluatedCount: 0,
      mcnFirstPassRateBps: null,
      mcnFirstEvaluatedCount: 0,
    });
  });

  it("uses final vendor reviews for pass rate and evaluations for failed reasons", () => {
    expect(
      aggregateStreamerAdmissionStats({
        organizationId: "org-1",
        applications: [
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [
              {
                id: "vendor-review-selected",
                organization_id: "org-1",
                decision: "selected",
              },
              {
                id: "vendor-review-rejected",
                organization_id: "org-1",
                decision: "rejected",
              },
            ],
            admission_review_evaluations: [
              {
                id: "evaluation-rejected",
                organization_id: "org-1",
                stage: "vendor_second",
                admission_review_checkpoint_results: [
                  {
                    organization_id: "org-1",
                    checkpoint_key: "audio_quality",
                    verdict: "fail",
                  },
                  {
                    organization_id: "org-1",
                    checkpoint_key: "compliance",
                    verdict: "fail",
                  },
                  {
                    organization_id: "org-1",
                    checkpoint_key: "opening_hook",
                    verdict: "pass",
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      vendorPassRateBps: 5000,
      rejectionReasonHistogram: {
        audio_quality: 1,
        compliance: 1,
      },
      evaluatedCount: 2,
      mcnFirstPassRateBps: null,
      mcnFirstEvaluatedCount: 0,
    });
  });

  it("deduplicates review ids, evaluation ids, and checkpoint joins", () => {
    const duplicateReview = {
      id: "vendor-review-duplicate",
      organization_id: "org-1",
      decision: "selected",
    };
    const duplicateEvaluation = {
      id: "evaluation-duplicate",
      organization_id: "org-1",
      stage: "vendor_second",
      admission_review_checkpoint_results: [
        {
          organization_id: "org-1",
          checkpoint_key: "compliance",
          verdict: "fail",
        },
        {
          organization_id: "org-1",
          checkpoint_key: "compliance",
          verdict: "fail",
        },
      ],
    };

    expect(
      aggregateStreamerAdmissionStats({
        organizationId: "org-1",
        applications: [
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [
              duplicateReview,
              duplicateReview,
            ],
            admission_review_evaluations: [
              duplicateEvaluation,
              duplicateEvaluation,
            ],
          },
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [duplicateReview],
            admission_review_evaluations: [duplicateEvaluation],
          },
        ],
      }),
    ).toEqual({
      vendorPassRateBps: 10_000,
      rejectionReasonHistogram: { compliance: 1 },
      evaluatedCount: 1,
      mcnFirstPassRateBps: null,
      mcnFirstEvaluatedCount: 0,
    });
  });

  it("merges failed reasons from repeated evaluations of the same vendor review", () => {
    expect(
      aggregateStreamerAdmissionStats({
        organizationId: "org-1",
        applications: [
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [
              {
                id: "vendor-review-1",
                organization_id: "org-1",
                decision: "rejected",
              },
            ],
            admission_review_evaluations: [
              {
                id: "evaluation-1",
                vendor_review_id: "vendor-review-1",
                organization_id: "org-1",
                stage: "vendor_second",
                admission_review_checkpoint_results: [
                  {
                    organization_id: "org-1",
                    checkpoint_key: "compliance",
                    verdict: "fail",
                  },
                ],
              },
              {
                id: "evaluation-2",
                vendor_review_id: "vendor-review-1",
                organization_id: "org-1",
                stage: "vendor_second",
                admission_review_checkpoint_results: [
                  {
                    organization_id: "org-1",
                    checkpoint_key: "compliance",
                    verdict: "fail",
                  },
                  {
                    organization_id: "org-1",
                    checkpoint_key: "audio_quality",
                    verdict: "fail",
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      vendorPassRateBps: 0,
      rejectionReasonHistogram: {
        audio_quality: 1,
        compliance: 1,
      },
      evaluatedCount: 1,
      mcnFirstPassRateBps: null,
      mcnFirstEvaluatedCount: 0,
    });
  });

  it("excludes pending reviews and cross-organization rows at every boundary", () => {
    expect(
      aggregateStreamerAdmissionStats({
        organizationId: "org-1",
        applications: [
          {
            organization_id: "org-2",
            project_recording_vendor_reviews: [
              {
                id: "vendor-review-foreign-application",
                organization_id: "org-1",
                decision: "selected",
              },
            ],
            admission_review_evaluations: [],
          },
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [
              {
                id: "vendor-review-foreign",
                organization_id: "org-2",
                decision: "selected",
              },
              {
                id: "vendor-review-pending",
                organization_id: "org-1",
                decision: "pending",
              },
              {
                id: "vendor-review-local",
                organization_id: "org-1",
                decision: "backup",
              },
            ],
            admission_review_evaluations: [
              {
                id: "evaluation-foreign",
                organization_id: "org-2",
                stage: "vendor_second",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-local",
                organization_id: "org-1",
                stage: "vendor_second",
                admission_review_checkpoint_results: [
                  {
                    organization_id: "org-2",
                    checkpoint_key: "foreign_reason",
                    verdict: "fail",
                  },
                  {
                    organization_id: "org-1",
                    checkpoint_key: "local_reason",
                    verdict: "fail",
                  },
                ],
              },
              {
                id: "evaluation-mcn",
                organization_id: "org-1",
                stage: "mcn_first",
                admission_review_checkpoint_results: [],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      vendorPassRateBps: 0,
      rejectionReasonHistogram: { local_reason: 1 },
      evaluatedCount: 1,
      mcnFirstPassRateBps: null,
      mcnFirstEvaluatedCount: 0,
    });
  });

  it("rounds review rates to integer basis points and preserves unit boundaries", () => {
    const review = (id: string, decision: string) => ({
      id,
      organization_id: "org-1",
      decision,
    });

    expect(
      aggregateStreamerAdmissionStats({
        organizationId: "org-1",
        applications: [
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [
              review("vendor-review-1", "selected"),
            ],
          },
        ],
      }).vendorPassRateBps,
    ).toBe(10_000);

    expect(
      aggregateStreamerAdmissionStats({
        organizationId: "org-1",
        applications: [
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [
              review("vendor-review-1", "selected"),
              review("vendor-review-2", "backup"),
              review("vendor-review-3", "needs_changes"),
            ],
          },
        ],
      }).vendorPassRateBps,
    ).toBe(3333);
  });

  it("keeps classified reasons when the corresponding review sample is absent", () => {
    expect(
      aggregateStreamerAdmissionStats({
        organizationId: "org-1",
        applications: [
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [],
            admission_review_evaluations: [
              {
                id: "legacy-evaluation",
                organization_id: "org-1",
                stage: "vendor_second",
                admission_review_checkpoint_results: [
                  {
                    organization_id: "org-1",
                    checkpoint_key: "legacy_reason",
                    verdict: "fail",
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      vendorPassRateBps: null,
      rejectionReasonHistogram: { legacy_reason: 1 },
      evaluatedCount: 0,
      mcnFirstPassRateBps: null,
      mcnFirstEvaluatedCount: 0,
    });
  });

  it("uses the latest final MCN evaluation for each recording submission", () => {
    expect(
      aggregateStreamerAdmissionStats({
        organizationId: "org-1",
        applications: [
          {
            organization_id: "org-1",
            admission_review_evaluations: [
              {
                id: "evaluation-sub-1-old",
                submission_id: "submission-1",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "rejected",
                created_at: "2026-07-24T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-sub-1-new",
                submission_id: "submission-1",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "approved",
                created_at: "2026-07-25T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-sub-2",
                submission_id: "submission-2",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "selected",
                created_at: "2026-07-25T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-sub-3",
                submission_id: "submission-3",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "needs_changes",
                created_at: "2026-07-25T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-sub-4-manual",
                submission_id: "submission-4",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "manual_review",
                created_at: "2026-07-25T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-sub-5-pending",
                submission_id: "submission-5",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "pending",
                created_at: "2026-07-25T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-sub-6-a",
                submission_id: "submission-6",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "rejected",
                created_at: "2026-07-25T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-sub-6-b",
                submission_id: "submission-6",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "approved",
                created_at: "2026-07-25T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      vendorPassRateBps: null,
      rejectionReasonHistogram: {},
      evaluatedCount: 0,
      mcnFirstPassRateBps: 7500,
      mcnFirstEvaluatedCount: 4,
    });
  });
});
