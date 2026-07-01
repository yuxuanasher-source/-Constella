export type KnowledgeAssetDocType =
  | "retrospective"
  | "sop"
  | "settlement_rule"
  | "evidence_rule"
  | "profile_note"
  | "manual"
  | "playbook";

export type KnowledgeAssetMetadata = {
  source: "knowledge_base" | "live_review" | "ai_draft";
  docId?: string;
  path?: string[];
  projectId?: string;
  streamerId?: string;
  liveTaskId?: string;
  product?: string;
  platform?: string;
  visibility?: string;
  updatedAt?: string;
  liveReviewDocumentId?: string;
  authorName?: string;
};

export type KnowledgeAssetDocument = {
  organizationId: string;
  docType: KnowledgeAssetDocType;
  title: string;
  body: string;
  sourceRef: string;
  tags: string[];
  createdBy?: string | null;
  metadata: KnowledgeAssetMetadata;
};

export type KnowledgeDocumentChunkInsert = {
  organization_id: string;
  knowledge_document_id: string;
  chunk_index: number;
  doc_type: KnowledgeAssetDocType;
  title: string;
  body: string;
  source_ref: string;
  tags: string[];
  metadata: KnowledgeAssetMetadata;
  project_id?: string;
  streamer_id?: string;
  live_task_id?: string;
  product?: string;
  platform?: string;
  updated_at?: string;
};

export type KnowledgeAssetIndexClient = {
  from(table: "knowledge_documents"): {
    upsert(
      payload: Record<string, unknown>,
      options: { onConflict: "organization_id,source_ref" },
    ): {
      select(columns: "id"): {
        single(): PromiseLike<{
          data: { id: string } | null;
          error: { message?: string } | Error | null;
        }>;
      };
    };
  };
  from(table: "knowledge_document_chunks"): {
    delete(): {
      match(payload: Record<string, unknown>): PromiseLike<{
        error: { message?: string } | Error | null;
      }>;
    };
    insert(payload: KnowledgeDocumentChunkInsert[]): PromiseLike<{
      error: { message?: string } | Error | null;
    }>;
  };
};

type KnowledgeStore = {
  nodes?: Record<string, KnowledgeStoreNode>;
};

type KnowledgeStoreNode = {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  parentId?: unknown;
  contentMd?: unknown;
  body?: unknown;
  content?: unknown;
  meta?: unknown;
  updatedAt?: unknown;
};

export type LiveReviewIndexDocument = {
  id: string;
  title: string;
  contentMd: string;
  product?: string | null;
  platform?: string | null;
  projectId?: string | null;
  streamerId?: string | null;
  liveTaskId?: string | null;
  tags?: string[] | null;
  authorName?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

const ALLOWED_DOC_TYPES = new Set<KnowledgeAssetDocType>([
  "retrospective",
  "sop",
  "settlement_rule",
  "evidence_rule",
  "profile_note",
  "manual",
  "playbook",
]);

export function buildIndexedDocumentsFromKnowledgeStore(input: {
  organizationId: string;
  store: unknown;
  actorUserId?: string | null;
}): KnowledgeAssetDocument[] {
  const store = recordValue(input.store)
    ? (input.store as KnowledgeStore)
    : null;
  const nodes = recordValue(store?.nodes) ? store.nodes : {};
  const documents: KnowledgeAssetDocument[] = [];

  for (const [fallbackId, node] of Object.entries(nodes ?? {})) {
    if (!recordValue(node) || node.type !== "doc") continue;

    const docId = stringValue(node.id) || fallbackId;
    const title = stringValue(node.name) || "未命名文档";
    const content = firstStringValue(node.contentMd, node.body, node.content);
    if (!content.trim()) continue;

    const meta = recordValue(node.meta) ? node.meta : {};
    const path = buildNodePath(docId, nodes ?? {});
    const docType = docTypeForKnowledgeNode(title, path, meta);
    const sourceRef = `knowledge_base:${docId}`;
    const metadata: KnowledgeAssetMetadata = compactMetadata({
      source: "knowledge_base",
      docId,
      path,
      projectId: stringValue(meta.projectId),
      streamerId: stringValue(meta.streamerId),
      product: stringValue(meta.product),
      platform: stringValue(meta.platform),
      visibility: stringValue(meta.visibility),
      updatedAt: stringValue(node.updatedAt),
    });

    documents.push({
      organizationId: input.organizationId,
      docType,
      title,
      body: knowledgeStoreBody({
        title,
        sourceRef,
        path,
        metadata,
        content,
      }),
      sourceRef,
      tags: normalizeTags([
        "knowledge_base",
        docType,
        ...path.slice(0, -1),
        ...arrayOfStrings(meta.tags),
      ]),
      createdBy: input.actorUserId ?? null,
      metadata,
    });
  }

  return documents;
}

export async function syncKnowledgeStoreToIndex(
  client: KnowledgeAssetIndexClient,
  input: {
    organizationId: string;
    store: unknown;
    actorUserId?: string | null;
  },
): Promise<{ indexedCount: number }> {
  const docs = buildIndexedDocumentsFromKnowledgeStore(input);
  for (const doc of docs) {
    await upsertKnowledgeAssetDocument(client, doc);
  }
  return { indexedCount: docs.length };
}

export function buildLiveReviewKnowledgeDocument(input: {
  organizationId: string;
  actorUserId?: string | null;
  document: LiveReviewIndexDocument;
}): KnowledgeAssetDocument {
  const sourceRef = `live_review:${input.document.id}`;
  const metadata: KnowledgeAssetMetadata = compactMetadata({
    source: "live_review",
    liveReviewDocumentId: input.document.id,
    projectId: input.document.projectId ?? undefined,
    streamerId: input.document.streamerId ?? undefined,
    liveTaskId: input.document.liveTaskId ?? undefined,
    product: input.document.product ?? undefined,
    platform: input.document.platform ?? undefined,
    authorName: input.document.authorName ?? undefined,
    updatedAt: input.document.updatedAt,
  });

  return {
    organizationId: input.organizationId,
    docType: "retrospective",
    title: input.document.title,
    body: liveReviewBody({
      title: input.document.title,
      sourceRef,
      content: input.document.contentMd,
      metadata,
    }),
    sourceRef,
    tags: normalizeTags([
      "live_review",
      "retrospective",
      input.document.product,
      input.document.platform,
      ...(input.document.tags ?? []),
    ]),
    createdBy: input.actorUserId ?? null,
    metadata,
  };
}

export async function syncLiveReviewDocumentToIndex(
  client: KnowledgeAssetIndexClient,
  input: {
    organizationId: string;
    actorUserId?: string | null;
    document: LiveReviewIndexDocument;
  },
): Promise<{ id: string }> {
  return upsertKnowledgeAssetDocument(
    client,
    buildLiveReviewKnowledgeDocument(input),
  );
}

export async function upsertKnowledgeAssetDocument(
  client: KnowledgeAssetIndexClient,
  doc: KnowledgeAssetDocument,
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("knowledge_documents")
    .upsert(
      {
        organization_id: doc.organizationId,
        doc_type: doc.docType,
        title: doc.title,
        body: doc.body,
        source_ref: doc.sourceRef,
        tags: doc.tags,
        created_by: doc.createdBy ?? null,
        metadata: doc.metadata,
      },
      { onConflict: "organization_id,source_ref" },
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message || "Failed to index knowledge document");
  }
  if (!data?.id) {
    throw new Error("Failed to index knowledge document");
  }
  await refreshKnowledgeDocumentChunks(client, doc, data.id);
  return { id: data.id };
}

export function buildKnowledgeDocumentChunks(
  doc: KnowledgeAssetDocument,
  knowledgeDocumentId: string,
  options: { maxChunkChars?: number } = {},
): KnowledgeDocumentChunkInsert[] {
  const maxChunkChars = Math.max(40, options.maxChunkChars ?? 900);
  const chunks = splitIntoChunks(doc.body, maxChunkChars);
  return chunks.map((body, index) => {
    const metadata = compactMetadata({
      ...doc.metadata,
      updatedAt: doc.metadata.updatedAt,
    });
    return compactChunk({
      organization_id: doc.organizationId,
      knowledge_document_id: knowledgeDocumentId,
      chunk_index: index,
      doc_type: doc.docType,
      title: doc.title,
      body,
      source_ref: `${doc.sourceRef}#chunk-${index + 1}`,
      tags: doc.tags,
      metadata,
      project_id: doc.metadata.projectId,
      streamer_id: doc.metadata.streamerId,
      live_task_id: doc.metadata.liveTaskId,
      product: doc.metadata.product,
      platform: doc.metadata.platform,
      updated_at: doc.metadata.updatedAt,
    });
  });
}

async function refreshKnowledgeDocumentChunks(
  client: KnowledgeAssetIndexClient,
  doc: KnowledgeAssetDocument,
  knowledgeDocumentId: string,
): Promise<void> {
  const { error: deleteError } = await client
    .from("knowledge_document_chunks")
    .delete()
    .match({
      organization_id: doc.organizationId,
      knowledge_document_id: knowledgeDocumentId,
    });
  if (deleteError) {
    throw new Error(
      deleteError.message || "Failed to refresh knowledge chunks",
    );
  }

  const chunks = buildKnowledgeDocumentChunks(doc, knowledgeDocumentId);
  if (!chunks.length) return;
  const { error: insertError } = await client
    .from("knowledge_document_chunks")
    .insert(chunks);
  if (insertError) {
    throw new Error(insertError.message || "Failed to index knowledge chunks");
  }
}

function docTypeForKnowledgeNode(
  title: string,
  path: string[],
  meta: Record<string, unknown>,
): KnowledgeAssetDocType {
  const metaDocType = stringValue(meta.docType);
  if (ALLOWED_DOC_TYPES.has(metaDocType as KnowledgeAssetDocType)) {
    return metaDocType as KnowledgeAssetDocType;
  }

  const haystack = `${path.join(" ")} ${title}`.toLowerCase();
  if (haystack.includes("结算")) return "settlement_rule";
  if (haystack.includes("证据") || haystack.includes("凭证")) {
    return "evidence_rule";
  }
  if (haystack.includes("sop") || haystack.includes("流程")) return "sop";
  if (haystack.includes("打法") || haystack.includes("玩法")) return "playbook";
  if (haystack.includes("复盘")) return "retrospective";
  return "manual";
}

function buildNodePath(
  docId: string,
  nodes: Record<string, KnowledgeStoreNode>,
): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = docId;

  for (let depth = 0; currentId && depth < 30; depth += 1) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const node = nodes[currentId];
    if (!recordValue(node)) break;
    const name = stringValue(node.name);
    if (name) path.unshift(name);
    const parentId = stringValue(node.parentId);
    currentId = parentId || null;
  }

  return path.length ? path : [docId];
}

function knowledgeStoreBody(input: {
  title: string;
  sourceRef: string;
  path: string[];
  metadata: KnowledgeAssetMetadata;
  content: string;
}): string {
  return (
    [
      `# ${input.title}`,
      "",
      `Source: ${input.sourceRef}`,
      `Path: ${input.path.join(" / ")}`,
      ...metadataLines(input.metadata),
      "",
      input.content.trim(),
    ]
      .filter((line) => line !== null)
      .join("\n")
      .trim() + "\n"
  );
}

function liveReviewBody(input: {
  title: string;
  sourceRef: string;
  content: string;
  metadata: KnowledgeAssetMetadata;
}): string {
  return (
    [
      `# ${input.title}`,
      "",
      `Source: ${input.sourceRef}`,
      ...metadataLines(input.metadata),
      "",
      input.content.trim(),
      "",
      "Note:复盘知识用于解释与行动建议；金额、时长、ROI 等数字仍以结构化业务数据为准。",
    ]
      .join("\n")
      .trim() + "\n"
  );
}

function metadataLines(metadata: KnowledgeAssetMetadata): string[] {
  const lines: string[] = [];
  if (metadata.projectId) lines.push(`Project: ${metadata.projectId}`);
  if (metadata.streamerId) lines.push(`Streamer: ${metadata.streamerId}`);
  if (metadata.liveTaskId) lines.push(`Live task: ${metadata.liveTaskId}`);
  if (metadata.product) lines.push(`Product: ${metadata.product}`);
  if (metadata.platform) lines.push(`Platform: ${metadata.platform}`);
  if (metadata.visibility) lines.push(`Visibility: ${metadata.visibility}`);
  if (metadata.updatedAt) lines.push(`Updated at: ${metadata.updatedAt}`);
  return lines;
}

function compactMetadata(
  metadata: KnowledgeAssetMetadata,
): KnowledgeAssetMetadata {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null || value === "") continue;
    compacted[key] = value;
  }
  return compacted as KnowledgeAssetMetadata;
}

function compactChunk(
  chunk: KnowledgeDocumentChunkInsert,
): KnowledgeDocumentChunkInsert {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(chunk)) {
    if (value === undefined || value === null || value === "") continue;
    compacted[key] = value;
  }
  return compacted as KnowledgeDocumentChunkInsert;
}

function splitIntoChunks(body: string, maxChunkChars: number): string[] {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    if (!current) {
      if (block.length <= maxChunkChars) {
        current = block;
      } else {
        chunks.push(...splitLongBlock(block, maxChunkChars));
      }
      continue;
    }

    if (`${current}\n\n${block}`.length <= maxChunkChars) {
      current = `${current}\n\n${block}`;
      continue;
    }
    chunks.push(current);
    current = "";
    if (block.length <= maxChunkChars) {
      current = block;
    } else {
      chunks.push(...splitLongBlock(block, maxChunkChars));
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitLongBlock(block: string, maxChunkChars: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < block.length; start += maxChunkChars) {
    chunks.push(block.slice(start, start + maxChunkChars));
  }
  return chunks;
}

function normalizeTags(values: unknown[]): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = String(value ?? "").trim();
    if (!tag) continue;
    tags.add(tag.slice(0, 40));
    if (tags.size >= 24) break;
  }
  return [...tags];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function firstStringValue(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
