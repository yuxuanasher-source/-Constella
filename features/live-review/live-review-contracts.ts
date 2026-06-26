import { z } from "zod";

// API DTO contracts for the live-review knowledge base.

export const saveLiveReviewSchema = z.object({
  title: z.string().trim().min(1, "复盘标题必填").max(200),
  contentMd: z.string().trim().min(1, "复盘内容不能为空"),
  liveTaskId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  streamerId: z.string().uuid().optional().nullable(),
  product: z.string().trim().max(200).optional(),
  platform: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export type SaveLiveReviewInput = z.infer<typeof saveLiveReviewSchema>;

export const listLiveReviewQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  streamerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListLiveReviewQuery = z.infer<typeof listLiveReviewQuerySchema>;

export const assistLiveReviewSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  streamerId: z.string().uuid().optional().nullable(),
  product: z.string().trim().max(200).optional(),
  platform: z.string().trim().max(60).optional(),
  streamer: z.string().trim().max(120).optional(),
  goal: z.string().trim().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type AssistLiveReviewInput = z.infer<typeof assistLiveReviewSchema>;

export type LiveReviewDocumentDto = {
  id: string;
  title: string;
  contentMd: string;
  product: string | null;
  platform: string | null;
  projectId: string | null;
  streamerId: string | null;
  liveTaskId: string | null;
  tags: string[];
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
};

type LiveReviewRow = {
  id: string;
  title: string;
  content_md: string;
  product: string | null;
  platform: string | null;
  project_id: string | null;
  streamer_id: string | null;
  live_task_id: string | null;
  tags: string[] | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

export function toLiveReviewDocumentDto(
  row: LiveReviewRow,
): LiveReviewDocumentDto {
  return {
    id: row.id,
    title: row.title,
    contentMd: row.content_md,
    product: row.product,
    platform: row.platform,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    liveTaskId: row.live_task_id,
    tags: row.tags ?? [],
    authorName: row.author_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
