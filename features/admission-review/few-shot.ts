// few-shot 检索：把最近的人工一审判例（含理由码）注入预审 prompt——
// 无微调条件下让模型学习组织审核口径的最有效方式，每条都是人工确认过的
// ground truth。同项目判例优先，不足时回退组织内最近判例。

import type { AdmissionPreReviewExample } from "./pre-review";

export const FEW_SHOT_DEFAULT_LIMIT = 4;
const CANDIDATE_POOL_SIZE = 30;

type ExampleRow = {
  id: string;
  decision: string;
  note: string | null;
  created_at: string;
  project_applications?: { project_id: string } | null;
  admission_review_checkpoint_results?: Array<{
    checkpoint_key: string;
    verdict: string;
  }> | null;
};

type FewShotDb = {
  from(table: "admission_review_evaluations"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        eq(
          column: "stage",
          value: string,
        ): {
          eq(
            column: "note_source",
            value: string,
          ): {
            order(
              column: "created_at",
              options: { ascending: boolean },
            ): {
              limit(count: number): PromiseLike<{
                data: ExampleRow[] | null;
                error: Error | null;
              }>;
            };
          };
        };
      };
    };
  };
};

export async function findSimilarReviewExamples({
  client,
  organizationId,
  projectId,
  limit = FEW_SHOT_DEFAULT_LIMIT,
}: {
  client: FewShotDb;
  organizationId: string;
  projectId?: string | null;
  limit?: number;
}): Promise<AdmissionPreReviewExample[]> {
  const { data, error } = await client
    .from("admission_review_evaluations")
    .select(
      "id, decision, note, created_at, project_applications(project_id), admission_review_checkpoint_results(checkpoint_key, verdict)",
    )
    .eq("organization_id", organizationId)
    .eq("stage", "mcn_first")
    .eq("note_source", "human")
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_POOL_SIZE);

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const sameProject = projectId
    ? rows.filter(
        (row) => row.project_applications?.project_id === projectId,
      )
    : [];
  const others = rows.filter((row) => !sameProject.includes(row));

  return [...sameProject, ...others].slice(0, Math.max(0, limit)).map(
    (row): AdmissionPreReviewExample => ({
      decision: row.decision,
      reasonCodes: (row.admission_review_checkpoint_results ?? [])
        .filter((result) => result.verdict === "fail")
        .map((result) => result.checkpoint_key),
      note: row.note,
    }),
  );
}
