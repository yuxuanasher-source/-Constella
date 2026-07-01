// 知识库 DB 检索（走 RLS）。fetch 受组织隔离的候选语料，再用确定性打分排序。
// 工具本身不碰库（见 ai-tool-layer 的 kb_search）；本仓库供 API 路由 / Agent 调用。

import {
  rankKnowledgePassages,
  type KnowledgeDoc,
  type KnowledgePassage,
} from "./knowledge-base";

type KnowledgeRow = {
  id: string;
  knowledge_document_id?: string | null;
  doc_type: string;
  title: string;
  body: string;
  source_ref: string;
  tags: string[] | null;
  project_id?: string | null;
  streamer_id?: string | null;
  live_task_id?: string | null;
  product?: string | null;
  platform?: string | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string | null;
};

type KnowledgeQuery = {
  eq(column: string, value: string): KnowledgeQuery;
  in(column: string, values: string[]): KnowledgeQuery;
  contains(column: string, values: string[]): KnowledgeQuery;
  gte(column: string, value: string): KnowledgeQuery;
  order(column: string, options: { ascending: boolean }): KnowledgeQuery;
  limit(
    count: number,
  ): PromiseLike<{ data: KnowledgeRow[] | null; error: unknown }>;
};

export type KnowledgeClient = {
  from(table: "knowledge_documents" | "knowledge_document_chunks"): {
    select(columns: string): KnowledgeQuery;
  };
};

export type SearchKnowledgeInput = {
  organizationId: string;
  query: string;
  docTypes?: string[];
  projectId?: string;
  streamerId?: string;
  product?: string;
  platform?: string;
  tags?: string[];
  updatedAfter?: string;
  // 候选拉取上限（先按组织/类型/时间取候选，再在内存里确定性打分）。
  candidateLimit?: number;
  limit?: number;
};

export async function searchKnowledgeDocuments(
  client: KnowledgeClient,
  input: SearchKnowledgeInput,
): Promise<KnowledgePassage[]> {
  const chunkRows = await fetchKnowledgeRows(client, input, {
    table: "knowledge_document_chunks",
    columns:
      "id, knowledge_document_id, doc_type, title, body, source_ref, tags, project_id, streamer_id, live_task_id, product, platform, updated_at",
    orderColumn: "updated_at",
    applyBusinessFilters: true,
  });

  if (chunkRows.length) {
    return rankRows(input, chunkRows, true);
  }

  const documentRows = await fetchKnowledgeRows(client, input, {
    table: "knowledge_documents",
    columns:
      "id, doc_type, title, body, source_ref, tags, metadata, updated_at",
    orderColumn: "updated_at",
    applyBusinessFilters: false,
  });

  return rankRows(input, documentRows, false);
}

async function fetchKnowledgeRows(
  client: KnowledgeClient,
  input: SearchKnowledgeInput,
  options: {
    table: "knowledge_documents" | "knowledge_document_chunks";
    columns: string;
    orderColumn: string;
    applyBusinessFilters: boolean;
  },
): Promise<KnowledgeRow[]> {
  let query = client
    .from(options.table)
    .select(options.columns)
    .eq("organization_id", input.organizationId);

  if (input.docTypes?.length) {
    query = query.in("doc_type", input.docTypes);
  }
  if (options.applyBusinessFilters && input.projectId) {
    query = query.eq("project_id", input.projectId);
  }
  if (options.applyBusinessFilters && input.streamerId) {
    query = query.eq("streamer_id", input.streamerId);
  }
  if (options.applyBusinessFilters && input.product) {
    query = query.eq("product", input.product);
  }
  if (options.applyBusinessFilters && input.platform) {
    query = query.eq("platform", input.platform);
  }
  if (input.tags?.length) {
    query = query.contains("tags", input.tags);
  }
  if (input.updatedAfter) {
    query = query.gte("updated_at", input.updatedAfter);
  }

  const { data, error } = await query
    .order(options.orderColumn, { ascending: false })
    .limit(input.candidateLimit ?? 200);

  return error || !data ? [] : data;
}

function rankRows(
  input: SearchKnowledgeInput,
  rows: KnowledgeRow[],
  rowsAreChunks: boolean,
): KnowledgePassage[] {
  const docs: KnowledgeDoc[] = rows.map((row) => {
    const metadata = row.metadata ?? {};
    return {
      id: row.id,
      docId: rowsAreChunks ? (row.knowledge_document_id ?? row.id) : row.id,
      docType: row.doc_type,
      title: row.title,
      body: row.body,
      sourceRef: row.source_ref,
      tags: row.tags ?? [],
      projectId: row.project_id ?? stringValue(metadata.projectId),
      streamerId: row.streamer_id ?? stringValue(metadata.streamerId),
      product: row.product ?? stringValue(metadata.product),
      platform: row.platform ?? stringValue(metadata.platform),
      updatedAt: row.updated_at ?? null,
    };
  });

  return rankKnowledgePassages(input.query, docs, input.limit ?? 5, {
    projectId: input.projectId,
    streamerId: input.streamerId,
    product: input.product,
    platform: input.platform,
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
