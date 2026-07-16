import { describe, expect, it, vi } from "vitest";

import { loadStreamerProjectMarketReferences } from "./streamer-project-market-references";

function createKnowledgeClient() {
  const rpc = vi.fn((fn: string) =>
    Promise.resolve(
      fn === "search_knowledge_document_chunks"
        ? {
            data: [
              {
                id: "chunk-legend-1",
                knowledge_document_id: "doc-legend-1",
                doc_type: "retrospective",
                title: "传奇复古同类项目复盘",
                body: "传奇复古同类直播间通常关注平均在线、讲解节奏和录屏可复用性。",
                source_ref: "knowledge_base:doc-legend-1#chunk-1",
                tags: ["传奇复古", "复盘"],
                project_id: null,
                streamer_id: null,
                product: "legend",
                platform: null,
                updated_at: "2026-07-15T00:00:00.000Z",
              },
            ],
            error: null,
          }
        : { data: [], error: null },
    ),
  );
  const from = vi.fn();
  return { client: { rpc, from }, rpc };
}

describe("loadStreamerProjectMarketReferences", () => {
  it("turns knowledge-base matches into streamer project external references", async () => {
    const { client, rpc } = createKnowledgeClient();

    const references = await loadStreamerProjectMarketReferences({
      client,
      organizationId: "org-1",
      retrievedAt: "2026-07-16T10:00:00.000Z",
      profileInput: {
        streamer: { id: "streamer-1", displayName: "阿星" },
        project: { id: "project-1", name: "传奇复古", productType: "legend" },
        tasks: [],
        reports: [],
        recordings: [],
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      "search_knowledge_document_chunks",
      expect.objectContaining({
        p_organization_id: "org-1",
        p_product: "legend",
      }),
    );
    expect(references).toEqual([
      {
        id: "knowledge:doc-legend-1:chunk-legend-1",
        title: "传奇复古同类项目复盘",
        sourceName: "知识库",
        sourceUrl: null,
        retrievedAt: "2026-07-16T10:00:00.000Z",
        summary: "传奇复古同类直播间通常关注平均在线、讲解节奏和录屏可复用性。",
        productType: "legend",
      },
    ]);
  });

  it("does not search when external references are already provided", async () => {
    const { client, rpc } = createKnowledgeClient();

    const references = await loadStreamerProjectMarketReferences({
      client,
      organizationId: "org-1",
      retrievedAt: "2026-07-16T10:00:00.000Z",
      profileInput: {
        streamer: { id: "streamer-1", displayName: "阿星" },
        project: { id: "project-1", name: "传奇复古", productType: "legend" },
        tasks: [],
        reports: [],
        recordings: [],
        externalReferences: [
          {
            id: "manual-ref-1",
            title: "运营手工参考",
            sourceName: "运营",
            sourceUrl: null,
            retrievedAt: "2026-07-16T09:00:00.000Z",
            summary: "已有人工补充参考。",
            productType: "legend",
          },
        ],
      },
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(references).toEqual([]);
  });
});
