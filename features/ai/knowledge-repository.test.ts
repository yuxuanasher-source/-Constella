import { describe, expect, it, vi } from "vitest";

import {
  searchKnowledgeDocuments,
  type KnowledgeClient,
} from "./knowledge-repository";

type RpcResult = { data: Record<string, unknown>[] | null; error: unknown };

// 下推路径的假 supabase：rpc 按函数名返回给定结果；from 仅用于断言未被调用。
function makePushdownClient(results: {
  chunks?: RpcResult;
  documents?: RpcResult;
}) {
  const rpc = vi.fn((fn: string) =>
    Promise.resolve(
      fn === "search_knowledge_document_chunks"
        ? (results.chunks ?? { data: [], error: null })
        : (results.documents ?? { data: [], error: null }),
    ),
  );
  const from = vi.fn(() => ({ select: vi.fn() }));
  return { client: { from, rpc } as unknown as KnowledgeClient, rpc, from };
}

// 兜底路径的假 builder（与旧实现的链式调用一致）。
function makeLegacyBuilder(rows: Record<string, unknown>[]) {
  const builder = {
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    contains: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return builder;
}

describe("searchKnowledgeDocuments candidate pushdown", () => {
  it("pushes matched-candidate filtering down to the chunks rpc", async () => {
    const { client, rpc, from } = makePushdownClient({});

    await searchKnowledgeDocuments(client, {
      organizationId: "org-1",
      query: "低毛利复盘",
      docTypes: ["retrospective"],
      projectId: "project-1",
      streamerId: "streamer-9",
      product: "星图",
      platform: "douyin",
      tags: ["低毛利"],
      updatedAfter: "2026-06-01T00:00:00.000Z",
    });

    // 分词与 JS 精排一致：整词 + 中文二元组。
    expect(rpc).toHaveBeenNthCalledWith(1, "search_knowledge_document_chunks", {
      p_organization_id: "org-1",
      p_terms: ["低毛利复盘", "低毛", "毛利", "利复", "复盘"],
      p_limit: 50,
      p_doc_types: ["retrospective"],
      p_project_id: "project-1",
      p_streamer_id: "streamer-9",
      p_product: "星图",
      p_platform: "douyin",
      p_tags: ["低毛利"],
      p_updated_after: "2026-06-01T00:00:00.000Z",
    });
    // chunks 无命中 → 回退 documents 表（documents RPC 不带业务列过滤）。
    expect(rpc).toHaveBeenNthCalledWith(2, "search_knowledge_documents", {
      p_organization_id: "org-1",
      p_terms: ["低毛利复盘", "低毛", "毛利", "利复", "复盘"],
      p_limit: 50,
      p_doc_types: ["retrospective"],
      p_tags: ["低毛利"],
      p_updated_after: "2026-06-01T00:00:00.000Z",
    });
    // 全量候选路径不应被触发。
    expect(from).not.toHaveBeenCalled();
  });

  it("honors an explicit candidateLimit in the pushdown", async () => {
    const { client, rpc } = makePushdownClient({});

    await searchKnowledgeDocuments(client, {
      organizationId: "org-1",
      query: "低毛利",
      candidateLimit: 200,
    });

    expect(rpc).toHaveBeenCalledWith(
      "search_knowledge_document_chunks",
      expect.objectContaining({ p_limit: 200 }),
    );
  });

  it("reranks same-context and recent chunks ahead of generic matches", async () => {
    const { client, rpc } = makePushdownClient({
      chunks: {
        data: [
          {
            id: "chunk-generic",
            knowledge_document_id: "doc-generic",
            doc_type: "manual",
            title: "低毛利通用说明",
            body: "低毛利项目需要核对成本。",
            source_ref: "knowledge_base:generic#chunk-1",
            tags: ["低毛利"],
            project_id: null,
            product: null,
            platform: null,
            updated_at: "2026-05-01T00:00:00.000Z",
          },
          {
            id: "chunk-project",
            knowledge_document_id: "doc-project",
            doc_type: "retrospective",
            title: "星图项目低毛利复盘",
            body: "低毛利项目需要核对成本，并优先检查星图投放补贴。",
            source_ref: "live_review:project#chunk-1",
            tags: ["低毛利", "复盘"],
            project_id: "project-1",
            product: "星图",
            platform: "douyin",
            updated_at: "2026-06-28T00:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const passages = await searchKnowledgeDocuments(client, {
      organizationId: "org-1",
      query: "低毛利 成本",
      projectId: "project-1",
      product: "星图",
      platform: "douyin",
      limit: 2,
    });

    expect(passages[0]).toMatchObject({
      id: "chunk-project",
      docId: "doc-project",
      sourceRef: "live_review:project#chunk-1",
    });
    expect(passages[0].score).toBeGreaterThan(passages[1].score);
    // chunks 已命中 → 不再查询 documents 表。
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back to document rows when chunks are not populated yet", async () => {
    const { client, rpc } = makePushdownClient({
      chunks: { data: [], error: null },
      documents: {
        data: [
          {
            id: "doc-1",
            doc_type: "sop",
            title: "低毛利 SOP",
            body: "低毛利项目需要核对成本。",
            source_ref: "knowledge_base:doc-1",
            tags: ["低毛利"],
            metadata: { product: "星图" },
            updated_at: "2026-06-28T00:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const passages = await searchKnowledgeDocuments(client, {
      organizationId: "org-1",
      query: "低毛利",
    });

    expect(rpc).toHaveBeenCalledWith(
      "search_knowledge_document_chunks",
      expect.anything(),
    );
    expect(rpc).toHaveBeenCalledWith(
      "search_knowledge_documents",
      expect.anything(),
    );
    expect(passages[0]).toMatchObject({
      id: "doc-1",
      sourceRef: "knowledge_base:doc-1",
    });
  });
});

describe("searchKnowledgeDocuments legacy fallback", () => {
  it("falls back to the full candidate fetch when the rpc is unavailable", async () => {
    const chunkBuilder = makeLegacyBuilder([
      {
        id: "chunk-1",
        knowledge_document_id: "doc-1",
        doc_type: "manual",
        title: "低毛利通用说明",
        body: "低毛利项目需要核对成本。",
        source_ref: "knowledge_base:generic#chunk-1",
        tags: ["低毛利"],
        updated_at: "2026-06-28T00:00:00.000Z",
      },
    ]);
    const rpc = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: "function missing" } }),
    );
    const from = vi.fn(() => ({ select: () => chunkBuilder }));

    const passages = await searchKnowledgeDocuments(
      { from, rpc } as unknown as KnowledgeClient,
      { organizationId: "org-1", query: "低毛利" },
    );

    expect(rpc).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("knowledge_document_chunks");
    expect(chunkBuilder.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chunkBuilder.limit).toHaveBeenCalledWith(200);
    expect(passages[0]).toMatchObject({
      id: "chunk-1",
      sourceRef: "knowledge_base:generic#chunk-1",
    });
  });

  it("keeps the legacy path for empty or too-short queries", async () => {
    const chunkBuilder = makeLegacyBuilder([
      {
        id: "chunk-1",
        knowledge_document_id: "doc-1",
        doc_type: "manual",
        title: "低毛利通用说明",
        body: "低毛利项目需要核对成本。",
        source_ref: "knowledge_base:generic#chunk-1",
        tags: ["低毛利"],
        updated_at: "2026-06-28T00:00:00.000Z",
      },
    ]);
    const rpc = vi.fn();
    const from = vi.fn(() => ({ select: () => chunkBuilder }));

    // 单字查询分不出有效查询词 → 不下推，保持旧行为（拉候选后精排出空集）。
    const passages = await searchKnowledgeDocuments(
      { from, rpc } as unknown as KnowledgeClient,
      { organizationId: "org-1", query: "利" },
    );

    expect(rpc).not.toHaveBeenCalled();
    expect(chunkBuilder.limit).toHaveBeenCalledWith(200);
    expect(passages).toEqual([]);
  });

  it("supports legacy clients without an rpc method", async () => {
    const chunkBuilder = makeLegacyBuilder([]);
    const docBuilder = makeLegacyBuilder([]);
    const from = vi.fn((table: string) => ({
      select: () =>
        table === "knowledge_document_chunks" ? chunkBuilder : docBuilder,
    }));

    const passages = await searchKnowledgeDocuments(
      { from } as unknown as KnowledgeClient,
      { organizationId: "org-1", query: "低毛利复盘" },
    );

    expect(from).toHaveBeenCalledWith("knowledge_document_chunks");
    expect(from).toHaveBeenCalledWith("knowledge_documents");
    expect(passages).toEqual([]);
  });

  it("applies business filters on the legacy chunk query", async () => {
    const chunkBuilder = makeLegacyBuilder([]);
    const docBuilder = makeLegacyBuilder([]);
    const rpc = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: "function missing" } }),
    );
    const from = vi.fn((table: string) => ({
      select: () =>
        table === "knowledge_document_chunks" ? chunkBuilder : docBuilder,
    }));

    await searchKnowledgeDocuments(
      { from, rpc } as unknown as KnowledgeClient,
      {
        organizationId: "org-1",
        query: "低毛利复盘",
        docTypes: ["retrospective"],
        projectId: "project-1",
        product: "星图",
        platform: "douyin",
        tags: ["低毛利"],
        updatedAfter: "2026-06-01T00:00:00.000Z",
      },
    );

    expect(from).toHaveBeenCalledWith("knowledge_document_chunks");
    expect(chunkBuilder.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chunkBuilder.in).toHaveBeenCalledWith("doc_type", [
      "retrospective",
    ]);
    expect(chunkBuilder.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(chunkBuilder.eq).toHaveBeenCalledWith("product", "星图");
    expect(chunkBuilder.eq).toHaveBeenCalledWith("platform", "douyin");
    expect(chunkBuilder.contains).toHaveBeenCalledWith("tags", ["低毛利"]);
    expect(chunkBuilder.gte).toHaveBeenCalledWith(
      "updated_at",
      "2026-06-01T00:00:00.000Z",
    );
  });
});
