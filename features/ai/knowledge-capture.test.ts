import { describe, expect, it, vi } from "vitest";

import {
  buildConfirmedDraftKnowledgeDocument,
  captureConfirmedDraftKnowledgeDocument,
  type KnowledgeCaptureClient,
} from "./knowledge-capture";
import type { AiDraftForConfirmation } from "./draft-repository";

function retrospectiveDraft(overrides: Partial<AiDraftForConfirmation> = {}) {
  return {
    id: "draft-review-1",
    draftType: "retrospective",
    targetStateMachine: "retrospective",
    targetState: "published",
    status: "pending",
    actingUserId: "ai-user",
    confirmedBy: null,
    createdAt: "2026-06-28T00:00:00.000Z",
    payload: {
      periodLabel: "June operations review",
      metrics: [
        {
          label: "Gross margin",
          value: "31.2",
          unit: "%",
          sourceRef: "dashboard.facts.margin",
        },
      ],
      sections: [
        {
          key: "next",
          title: "Next actions",
          prompt: "Review low margin projects and update the playbook.",
        },
      ],
      references: [
        {
          index: 1,
          title: "Historical review SOP",
          sourceRef: "SOP/review-v1",
          docId: "doc-1",
        },
      ],
    },
    ...overrides,
  } satisfies AiDraftForConfirmation;
}

describe("buildConfirmedDraftKnowledgeDocument", () => {
  it("turns a confirmed retrospective draft into a searchable knowledge document", () => {
    const doc = buildConfirmedDraftKnowledgeDocument({
      draft: retrospectiveDraft(),
      organizationId: "org-1",
      confirmedBy: "user-owner",
    });

    expect(doc).toMatchObject({
      organizationId: "org-1",
      docType: "retrospective",
      title: "AI review deposit: June operations review",
      sourceRef: "ai_draft:draft-review-1",
      createdBy: "user-owner",
    });
    expect(doc.body).toContain("Gross margin");
    expect(doc.body).toContain("dashboard.facts.margin");
    expect(doc.body).toContain("Historical review SOP");
    expect(doc.tags).toEqual(
      expect.arrayContaining(["ai_draft", "retrospective", "confirmed"]),
    );
  });

  it("keeps suggested action outcomes as reusable playbook knowledge", () => {
    const doc = buildConfirmedDraftKnowledgeDocument({
      draft: retrospectiveDraft({
        id: "draft-action-1",
        draftType: "suggested_action_todo",
        targetStateMachine: "operations_todo",
        targetState: "created",
        payload: {
          title: "Review low margin project",
          priority: "high",
          projectName: "Nova Launch",
          rationale: "Margin warning needs human handling.",
          evidence: [
            {
              sourceTool: "role_home_dashboard",
              sourceId: "panel:projectRanking:rank:p-low-margin",
            },
          ],
        },
      }),
      organizationId: "org-1",
      confirmedBy: "user-owner",
    });

    expect(doc.docType).toBe("playbook");
    expect(doc.title).toBe("AI action learning: Review low margin project");
    expect(doc.body).toContain("Nova Launch");
    expect(doc.body).toContain("panel:projectRanking:rank:p-low-margin");
  });
});

describe("captureConfirmedDraftKnowledgeDocument", () => {
  it("upserts the built document into knowledge_documents", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "kb-1" },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const upsert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ upsert }));

    const result = await captureConfirmedDraftKnowledgeDocument(
      { from } as unknown as KnowledgeCaptureClient,
      {
        draft: retrospectiveDraft(),
        organizationId: "org-1",
        confirmedBy: "user-owner",
      },
    );

    expect(from).toHaveBeenCalledWith("knowledge_documents");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        doc_type: "retrospective",
        source_ref: "ai_draft:draft-review-1",
        created_by: "user-owner",
      }),
      { onConflict: "organization_id,source_ref" },
    );
    expect(result).toEqual({ id: "kb-1" });
  });
});
