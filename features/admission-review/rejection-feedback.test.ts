import { describe, expect, it } from "vitest";

import { listLatestRejectionFeedback } from "./rejection-feedback";

function createFakeClient({
  evaluations = [] as Array<Record<string, unknown>>,
  results = [] as Array<Record<string, unknown>>,
} = {}) {
  return {
    from(table: string) {
      if (table === "admission_review_evaluations") {
        return {
          select: () => ({
            in: () => ({
              in: () => ({
                in: () => ({
                  order: async () => ({ data: evaluations, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "admission_review_checkpoint_results") {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: results, error: null }),
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
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe("listLatestRejectionFeedback", () => {
  it("returns the latest rejection with labeled fail checkpoints", async () => {
    const client = createFakeClient({
      evaluations: [
        {
          id: "evaluation-2",
          application_id: "application-1",
          stage: "vendor_second",
          decision: "rejected",
          note: "话术不贴卖点",
          created_at: "2026-07-03T10:00:00.000Z",
        },
        {
          id: "evaluation-1",
          application_id: "application-1",
          stage: "mcn_first",
          decision: "needs_changes",
          note: "旧一轮反馈",
          created_at: "2026-07-01T10:00:00.000Z",
        },
      ],
      results: [
        {
          evaluation_id: "evaluation-2",
          checkpoint_key: "script_fit",
          verdict: "fail",
          note: "缺少开服冲榜卖点",
        },
      ],
    });

    const feedback = await listLatestRejectionFeedback({
      client,
      organizationId: "org-1",
      applicationIds: ["application-1"],
    });

    expect(feedback.get("application-1")).toEqual({
      stage: "vendor_second",
      decision: "rejected",
      note: "话术不贴卖点",
      createdAt: "2026-07-03T10:00:00.000Z",
      reasons: [
        {
          key: "script_fit",
          label: "话术贴合项目卖点",
          note: "缺少开服冲榜卖点",
        },
      ],
    });
  });

  it("returns an empty map when there is nothing to report", async () => {
    const feedback = await listLatestRejectionFeedback({
      client: createFakeClient(),
      organizationId: "org-1",
      applicationIds: ["application-1"],
    });

    expect(feedback.size).toBe(0);
  });

  it("skips the query entirely for empty application lists", async () => {
    const feedback = await listLatestRejectionFeedback({
      client: {
        from() {
          throw new Error("should not query");
        },
      } as never,
      organizationId: "org-1",
      applicationIds: [],
    });

    expect(feedback.size).toBe(0);
  });
});
