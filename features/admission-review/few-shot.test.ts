import { describe, expect, it } from "vitest";

import { findSimilarReviewExamples } from "./few-shot";

function exampleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evaluation-1",
    decision: "rejected",
    note: "话术不贴卖点",
    created_at: "2026-07-01T10:00:00.000Z",
    project_applications: { project_id: "project-other" },
    admission_review_checkpoint_results: [
      { checkpoint_key: "script_fit", verdict: "fail" },
      { checkpoint_key: "opening_hook", verdict: "pass" },
    ],
    ...overrides,
  };
}

function createClient(rows: Array<Record<string, unknown>>) {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: rows, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  } as never;
}

describe("findSimilarReviewExamples", () => {
  it("prefers same-project examples and maps fail results to reason codes", async () => {
    const examples = await findSimilarReviewExamples({
      client: createClient([
        exampleRow({ id: "evaluation-other" }),
        exampleRow({
          id: "evaluation-same-project",
          decision: "needs_changes",
          project_applications: { project_id: "project-1" },
        }),
      ]),
      organizationId: "org-1",
      projectId: "project-1",
      limit: 2,
    });

    expect(examples).toHaveLength(2);
    // 同项目判例排在最前。
    expect(examples[0].decision).toBe("needs_changes");
    expect(examples[0].reasonCodes).toEqual(["script_fit"]);
    expect(examples[1].decision).toBe("rejected");
  });

  it("returns an empty list when there is no history", async () => {
    await expect(
      findSimilarReviewExamples({
        client: createClient([]),
        organizationId: "org-1",
      }),
    ).resolves.toEqual([]);
  });
});
