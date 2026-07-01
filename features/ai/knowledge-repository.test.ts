import { describe, expect, it, vi } from "vitest";

import {
  searchKnowledgeDocuments,
  type KnowledgeClient,
} from "./knowledge-repository";

function makeChunkClient(rows: Record<string, unknown>[]) {
  const eq = vi.fn(() => builder);
  const inFn = vi.fn(() => builder);
  const contains = vi.fn(() => builder);
  const gte = vi.fn(() => builder);
  const order = vi.fn(() => builder);
  const limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  const builder = { eq, in: inFn, contains, gte, order, limit };
  const select = vi.fn(() => builder);
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as KnowledgeClient, from, builder };
}

describe("searchKnowledgeDocuments chunk retrieval", () => {
  it("queries chunk rows with business filters", async () => {
    const { client, from, builder } = makeChunkClient([]);

    await searchKnowledgeDocuments(client, {
      organizationId: "org-1",
      query: "低毛利复盘",
      docTypes: ["retrospective"],
      projectId: "project-1",
      product: "星图",
      platform: "douyin",
      tags: ["低毛利"],
      updatedAfter: "2026-06-01T00:00:00.000Z",
    });

    expect(from).toHaveBeenCalledWith("knowledge_document_chunks");
    expect(builder.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(builder.in).toHaveBeenCalledWith("doc_type", ["retrospective"]);
    expect(builder.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(builder.eq).toHaveBeenCalledWith("product", "星图");
    expect(builder.eq).toHaveBeenCalledWith("platform", "douyin");
    expect(builder.contains).toHaveBeenCalledWith("tags", ["低毛利"]);
    expect(builder.gte).toHaveBeenCalledWith(
      "updated_at",
      "2026-06-01T00:00:00.000Z",
    );
  });

  it("reranks same-context and recent chunks ahead of generic matches", async () => {
    const { client } = makeChunkClient([
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
    ]);

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
  });

  it("falls back to document rows when chunks are not populated yet", async () => {
    const chunkBuilder = {
      eq: vi.fn(() => chunkBuilder),
      in: vi.fn(() => chunkBuilder),
      contains: vi.fn(() => chunkBuilder),
      gte: vi.fn(() => chunkBuilder),
      order: vi.fn(() => chunkBuilder),
      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };
    const docBuilder = {
      eq: vi.fn(() => docBuilder),
      in: vi.fn(() => docBuilder),
      contains: vi.fn(() => docBuilder),
      gte: vi.fn(() => docBuilder),
      order: vi.fn(() => docBuilder),
      limit: vi.fn(() =>
        Promise.resolve({
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
        }),
      ),
    };
    const from = vi.fn((table: string) => ({
      select: () =>
        table === "knowledge_document_chunks" ? chunkBuilder : docBuilder,
    }));

    const passages = await searchKnowledgeDocuments(
      { from } as unknown as KnowledgeClient,
      {
        organizationId: "org-1",
        query: "低毛利",
      },
    );

    expect(from).toHaveBeenCalledWith("knowledge_document_chunks");
    expect(from).toHaveBeenCalledWith("knowledge_documents");
    expect(passages[0]).toMatchObject({
      id: "doc-1",
      sourceRef: "knowledge_base:doc-1",
    });
  });
});
