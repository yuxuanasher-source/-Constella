import type { SupabaseClient } from "@supabase/supabase-js";

export type AdmissionShareBoardProgress = {
  itemCount: number;
  draftCompletedCount: number;
};

type AdmissionShareBoardProgressRow = {
  share_board_id: string;
  item_count: number | string;
  draft_completed_count: number | string;
};

export async function listAdmissionShareBoardProgress(
  client: SupabaseClient,
  projectIds: string[],
): Promise<Map<string, AdmissionShareBoardProgress>> {
  if (projectIds.length === 0) {
    return new Map();
  }

  const { data, error } = await client.rpc(
    "list_admission_share_board_progress",
    {
      p_project_ids: [...new Set(projectIds)],
    },
  );
  if (error) {
    throw error;
  }

  return new Map(
    ((data ?? []) as AdmissionShareBoardProgressRow[]).map((row) => {
      const itemCount = nonnegativeCount(row.item_count, "item_count");
      const draftCompletedCount = nonnegativeCount(
        row.draft_completed_count,
        "draft_completed_count",
      );
      return [
        row.share_board_id,
        {
          itemCount,
          draftCompletedCount: Math.min(draftCompletedCount, itemCount),
        },
      ];
    }),
  );
}

function nonnegativeCount(value: number | string, field: string) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Admission share progress ${field} is invalid`);
  }
  return count;
}
