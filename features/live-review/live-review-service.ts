import type { SupabaseClient } from "@supabase/supabase-js";

import {
  syncLiveReviewDocumentToIndex,
  type KnowledgeAssetIndexClient,
} from "@/features/ai/knowledge-asset-index";
import { writeAuditLog } from "@/lib/audit/audit";
import { isMcnStaff } from "@/lib/rbac/roles";
import type { AppRole } from "@/lib/rbac/roles";

import {
  toLiveReviewDocumentDto,
  type LiveReviewDocumentDto,
  type SaveLiveReviewInput,
  type ListLiveReviewQuery,
} from "./live-review-contracts";

export type LiveReviewActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

const SELECT_COLUMNS =
  "id, title, content_md, product, platform, project_id, streamer_id, live_task_id, tags, author_name, created_at, updated_at";

function assertStaff(actor: LiveReviewActor): void {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can manage live review knowledge base");
  }
}

export async function saveLiveReviewDocument(
  client: SupabaseClient,
  actor: LiveReviewActor,
  input: SaveLiveReviewInput,
): Promise<LiveReviewDocumentDto> {
  assertStaff(actor);

  const payload = {
    organization_id: actor.organizationId,
    title: input.title,
    content_md: input.contentMd,
    product: input.product ?? null,
    platform: input.platform ?? null,
    project_id: input.projectId ?? null,
    streamer_id: input.streamerId ?? null,
    live_task_id: input.liveTaskId ?? null,
    tags: input.tags ?? [],
    author_id: actor.userId,
    author_name: actor.name ?? null,
  };

  const { data, error } = await client
    .from("live_review_documents")
    .insert(payload)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await writeAuditLog(client, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "live_review",
    objectType: "live_review_document",
    objectId: data.id,
    objectName: input.title,
    projectId: input.projectId ?? undefined,
    streamerId: input.streamerId ?? undefined,
    after: { title: input.title },
  });

  const document = toLiveReviewDocumentDto(data);
  await syncLiveReviewDocumentToIndex(
    client as unknown as KnowledgeAssetIndexClient,
    {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      document,
    },
  );

  return document;
}

export async function listLiveReviewDocuments(
  client: SupabaseClient,
  actor: LiveReviewActor,
  query: ListLiveReviewQuery = {},
): Promise<LiveReviewDocumentDto[]> {
  assertStaff(actor);

  let builder = client
    .from("live_review_documents")
    .select(SELECT_COLUMNS)
    .eq("organization_id", actor.organizationId)
    .order("created_at", { ascending: false })
    .limit(query.limit ?? 50);

  if (query.projectId) {
    builder = builder.eq("project_id", query.projectId);
  }
  if (query.streamerId) {
    builder = builder.eq("streamer_id", query.streamerId);
  }

  const { data, error } = await builder;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toLiveReviewDocumentDto);
}
