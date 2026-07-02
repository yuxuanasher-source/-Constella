// 知识库 DB 检索（走 RLS）。候选集过滤已下推到数据库：pg_trgm + ilike 的 RPC 只回传
// 「命中查询词」的前 N 条（见 supabase/migrations/20260702130000_knowledge_search_trgm.sql），
// JS 端仅对小候选集做确定性精排，相关性语义与旧实现一致。
// 查询词为空 / RPC 不可用（迁移未上线、旧测试桩）时回退旧的全量候选路径兜底。
// 工具本身不碰库（见 ai-tool-layer 的 kb_search）；本仓库供 API 路由 / Agent 调用。

import {
  rankKnowledgePassages,
  tokenizeQuery,
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

// 下推检索 RPC 的入参（与迁移里的函数签名一一对应；documents 表没有业务列，
// 因此 project/streamer/product/platform 仅在 chunks RPC 上传递）。
export type KnowledgeSearchRpcArgs = {
  p_organization_id: string;
  p_terms: string[];
  p_limit: number;
  p_doc_types: string[] | null;
  p_tags: string[] | null;
  p_updated_after: string | null;
  p_project_id?: string | null;
  p_streamer_id?: string | null;
  p_product?: string | null;
  p_platform?: string | null;
};

export type KnowledgeClient = {
  from(table: "knowledge_documents" | "knowledge_document_chunks"): {
    select(columns: string): KnowledgeQuery;
  };
  rpc(
    fn: "search_knowledge_document_chunks" | "search_knowledge_documents",
    args: KnowledgeSearchRpcArgs,
  ): PromiseLike<{ data: KnowledgeRow[] | null; error: unknown }>;
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
  // 候选拉取上限。下推路径默认只取命中查询词的前 50 条；兜底路径保持 200。
  candidateLimit?: number;
  limit?: number;
};

// 下推路径：数据库已过滤出命中行，小候选集足够 JS 精排（精排只保留 score > 0 的行）。
const MATCHED_CANDIDATE_LIMIT = 50;
// 兜底路径（查询词为空 / RPC 不可用）：保持旧实现的全量候选上限。
const FALLBACK_CANDIDATE_LIMIT = 200;

export async function searchKnowledgeDocuments(
  client: KnowledgeClient,
  input: SearchKnowledgeInput,
): Promise<KnowledgePassage[]> {
  // 与精排（rankKnowledgePassages）同一套分词，保证下推命中语义 = JS score > 0。
  const terms = tokenizeQuery(input.query);

  const chunkRows = await fetchKnowledgeRows(client, input, {
    table: "knowledge_document_chunks",
    columns:
      "id, knowledge_document_id, doc_type, title, body, source_ref, tags, project_id, streamer_id, live_task_id, product, platform, updated_at",
    orderColumn: "updated_at",
    applyBusinessFilters: true,
    terms,
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
    terms,
  });

  return rankRows(input, documentRows, false);
}

type FetchKnowledgeRowsOptions = {
  table: "knowledge_documents" | "knowledge_document_chunks";
  columns: string;
  orderColumn: string;
  applyBusinessFilters: boolean;
  terms: string[];
};

async function fetchKnowledgeRows(
  client: KnowledgeClient,
  input: SearchKnowledgeInput,
  options: FetchKnowledgeRowsOptions,
): Promise<KnowledgeRow[]> {
  // 下推路径：有查询词且客户端支持 RPC 时，只让数据库回传命中候选。
  if (options.terms.length && typeof client.rpc === "function") {
    const matched = await fetchMatchedCandidates(client, input, options);
    if (matched) return matched;
  }

  // 兜底路径（与旧实现一致）：按组织 / 类型 / 时间取候选，交给内存打分。
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
    .limit(input.candidateLimit ?? FALLBACK_CANDIDATE_LIMIT);

  return error || !data ? [] : data;
}

async function fetchMatchedCandidates(
  client: KnowledgeClient,
  input: SearchKnowledgeInput,
  options: FetchKnowledgeRowsOptions,
): Promise<KnowledgeRow[] | null> {
  const args: KnowledgeSearchRpcArgs = {
    p_organization_id: input.organizationId,
    p_terms: options.terms,
    p_limit: input.candidateLimit ?? MATCHED_CANDIDATE_LIMIT,
    p_doc_types: input.docTypes?.length ? input.docTypes : null,
    p_tags: input.tags?.length ? input.tags : null,
    p_updated_after: input.updatedAfter ?? null,
  };

  const { data, error } =
    options.table === "knowledge_document_chunks"
      ? await client.rpc("search_knowledge_document_chunks", {
          ...args,
          p_project_id: input.projectId ?? null,
          p_streamer_id: input.streamerId ?? null,
          p_product: input.product ?? null,
          p_platform: input.platform ?? null,
        })
      : await client.rpc("search_knowledge_documents", args);

  // RPC 失败（如迁移未上线）→ null，让调用方走旧全量路径兜底；
  // 成功但空集是有效结果（无命中），直接采用。
  return error || !data ? null : data;
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
