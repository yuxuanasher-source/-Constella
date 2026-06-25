// 知识库 DB 检索（走 RLS）。fetch 受组织隔离的候选语料，再用确定性打分排序。
// 工具本身不碰库（见 ai-tool-layer 的 kb_search）；本仓库供 API 路由 / Agent 调用。

import {
  rankKnowledgePassages,
  type KnowledgeDoc,
  type KnowledgePassage,
} from "./knowledge-base";

type KnowledgeRow = {
  id: string;
  doc_type: string;
  title: string;
  body: string;
  source_ref: string;
  tags: string[] | null;
};

type KnowledgeQuery = {
  eq(column: string, value: string): KnowledgeQuery;
  in(column: string, values: string[]): KnowledgeQuery;
  order(
    column: string,
    options: { ascending: boolean },
  ): KnowledgeQuery;
  limit(count: number): PromiseLike<{ data: KnowledgeRow[] | null; error: unknown }>;
};

export type KnowledgeClient = {
  from(table: "knowledge_documents"): {
    select(columns: string): KnowledgeQuery;
  };
};

export type SearchKnowledgeInput = {
  organizationId: string;
  query: string;
  docTypes?: string[];
  // 候选拉取上限（先按组织/类型/时间取候选，再在内存里确定性打分）。
  candidateLimit?: number;
  limit?: number;
};

export async function searchKnowledgeDocuments(
  client: KnowledgeClient,
  input: SearchKnowledgeInput,
): Promise<KnowledgePassage[]> {
  let query = client
    .from("knowledge_documents")
    .select("id, doc_type, title, body, source_ref, tags")
    .eq("organization_id", input.organizationId);

  if (input.docTypes?.length) {
    query = query.in("doc_type", input.docTypes);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(input.candidateLimit ?? 200);

  if (error || !data) return [];

  const docs: KnowledgeDoc[] = data.map((row) => ({
    id: row.id,
    docType: row.doc_type,
    title: row.title,
    body: row.body,
    sourceRef: row.source_ref,
    tags: row.tags ?? [],
  }));

  return rankKnowledgePassages(input.query, docs, input.limit ?? 5);
}
