import { describe, expect, it, vi } from "vitest";

import {
  buildIndexedDocumentsFromKnowledgeStore,
  buildLiveReviewKnowledgeDocument,
  syncKnowledgeStoreToIndex,
  syncLiveReviewDocumentToIndex,
  type KnowledgeAssetIndexClient,
} from "./knowledge-asset-index";

function mockIndexClient() {
  const single = vi.fn().mockResolvedValue({
    data: { id: "kb-1" },
    error: null,
  });
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));
  return {
    client: { from } as unknown as KnowledgeAssetIndexClient,
    from,
    upsert,
  };
}

describe("buildIndexedDocumentsFromKnowledgeStore", () => {
  it("turns editable tree documents into traceable RAG assets", () => {
    const docs = buildIndexedDocumentsFromKnowledgeStore({
      organizationId: "org-1",
      actorUserId: "user-1",
      store: {
        version: 1,
        nodes: {
          root: {
            id: "root",
            type: "folder",
            name: "知识库",
            parentId: null,
            order: 0,
          },
          sop: {
            id: "sop",
            type: "folder",
            name: "直播 SOP",
            parentId: "root",
            order: 1,
          },
          doc1: {
            id: "doc1",
            type: "doc",
            name: "低毛利复盘 SOP",
            parentId: "sop",
            order: 0,
            contentMd: "# 低毛利复盘\n\n确认成本、坑位费和结算口径。",
            meta: {
              docType: "sop",
              projectId: "project-1",
              product: "星图",
              platform: "douyin",
              tags: ["低毛利", "复盘"],
            },
            updatedAt: "2026-06-28T02:00:00.000Z",
          },
        },
      },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      organizationId: "org-1",
      docType: "sop",
      title: "低毛利复盘 SOP",
      sourceRef: "knowledge_base:doc1",
      createdBy: "user-1",
      metadata: {
        source: "knowledge_base",
        docId: "doc1",
        path: ["知识库", "直播 SOP", "低毛利复盘 SOP"],
        projectId: "project-1",
        product: "星图",
        platform: "douyin",
      },
    });
    expect(docs[0].body).toContain("确认成本、坑位费和结算口径");
    expect(docs[0].tags).toEqual(
      expect.arrayContaining(["knowledge_base", "sop", "直播 SOP", "低毛利"]),
    );
  });

  it("skips empty or folder-only nodes", () => {
    const docs = buildIndexedDocumentsFromKnowledgeStore({
      organizationId: "org-1",
      store: {
        version: 1,
        nodes: {
          root: { id: "root", type: "folder", name: "知识库" },
          doc1: { id: "doc1", type: "doc", name: "空文档", contentMd: "   " },
        },
      },
    });

    expect(docs).toEqual([]);
  });
});

describe("syncKnowledgeStoreToIndex", () => {
  it("upserts editable tree documents by organization and source ref", async () => {
    const { client, from, upsert } = mockIndexClient();

    const result = await syncKnowledgeStoreToIndex(client, {
      organizationId: "org-1",
      actorUserId: "user-1",
      store: {
        version: 1,
        nodes: {
          doc1: {
            id: "doc1",
            type: "doc",
            name: "项目复盘",
            contentMd: "复盘正文",
          },
        },
      },
    });

    expect(from).toHaveBeenCalledWith("knowledge_documents");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        source_ref: "knowledge_base:doc1",
        body: expect.stringContaining("复盘正文"),
        metadata: expect.objectContaining({ source: "knowledge_base" }),
      }),
      { onConflict: "organization_id,source_ref" },
    );
    expect(result).toEqual({ indexedCount: 1 });
  });
});

describe("syncLiveReviewDocumentToIndex", () => {
  it("projects saved live-review documents into the shared AI index", async () => {
    const { client, upsert } = mockIndexClient();
    const doc = buildLiveReviewKnowledgeDocument({
      organizationId: "org-1",
      actorUserId: "user-1",
      document: {
        id: "review-1",
        title: "6 月 28 日复盘",
        contentMd: "低毛利项目需要优先核对成本。",
        product: "星图",
        platform: "douyin",
        projectId: "project-1",
        streamerId: "streamer-1",
        liveTaskId: "task-1",
        tags: ["低毛利"],
        authorName: "运营",
        createdAt: "2026-06-28T02:00:00.000Z",
        updatedAt: "2026-06-28T02:00:00.000Z",
      },
    });

    expect(doc).toMatchObject({
      organizationId: "org-1",
      docType: "retrospective",
      sourceRef: "live_review:review-1",
      metadata: {
        source: "live_review",
        liveReviewDocumentId: "review-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        liveTaskId: "task-1",
      },
    });
    expect(doc.body).toContain("低毛利项目需要优先核对成本");

    await syncLiveReviewDocumentToIndex(client, {
      organizationId: "org-1",
      actorUserId: "user-1",
      document: {
        id: "review-1",
        title: "6 月 28 日复盘",
        contentMd: "低毛利项目需要优先核对成本。",
        product: "星图",
        platform: "douyin",
        projectId: "project-1",
        streamerId: "streamer-1",
        liveTaskId: "task-1",
        tags: ["低毛利"],
        authorName: "运营",
        createdAt: "2026-06-28T02:00:00.000Z",
        updatedAt: "2026-06-28T02:00:00.000Z",
      },
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        doc_type: "retrospective",
        source_ref: "live_review:review-1",
        tags: expect.arrayContaining([
          "live_review",
          "retrospective",
          "低毛利",
        ]),
      }),
      { onConflict: "organization_id,source_ref" },
    );
  });
});
