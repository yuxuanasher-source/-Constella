import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmAiDraft,
  getAiDraftForConfirmation,
} from "@/features/ai/draft-repository";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/audit/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/features/ai/draft-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/ai/draft-repository")
  >("@/features/ai/draft-repository");
  return {
    ...actual,
    getAiDraftForConfirmation: vi.fn(),
    confirmAiDraft: vi.fn(),
  };
});

const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

const pendingSettlementDraft = {
  id: "draft-1",
  draftType: "settlement_batch",
  targetStateMachine: "settlement",
  targetState: "confirmed",
  payload: { totals: { itemCount: 2 } },
  status: "pending",
  createdAt: "2026-06-28T00:00:00.000Z",
};

function params(id = "draft-1") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/ai/drafts/[id]/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
    vi.mocked(getAiDraftForConfirmation).mockResolvedValue(
      pendingSettlementDraft as never,
    );
    vi.mocked(confirmAiDraft).mockResolvedValue(true);
    vi.mocked(writeAuditLog).mockResolvedValue(undefined as never);
  });

  it("confirms through the state gateway and writes an auditable decision", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/ai/drafts/draft-1/confirm", {
        method: "POST",
      }),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getAiDraftForConfirmation).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      draftId: "draft-1",
    });
    expect(confirmAiDraft).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      draftId: "draft-1",
      confirmedBy: "user-owner",
    });
    expect(body.gatewayDecision).toMatchObject({
      decision: "draft_only",
      tier: "L4_FORBIDDEN",
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-owner",
        action: "approve",
        module: "ai",
        objectType: "ai_draft",
        objectId: "draft-1",
        objectName: "settlement_batch:draft-1",
        changedFields: [
          "status",
          "confirmed_by",
          "gateway_decision",
        ],
        after: expect.objectContaining({
          status: "confirmed",
          confirmedBy: "user-owner",
          draftType: "settlement_batch",
          targetStateMachine: "settlement",
          targetState: "confirmed",
          gatewayDecision: expect.objectContaining({
            decision: "draft_only",
            tier: "L4_FORBIDDEN",
          }),
        }),
      }),
    );
  });

  it("rejects already handled drafts before mutating them", async () => {
    vi.mocked(getAiDraftForConfirmation).mockResolvedValue({
      ...pendingSettlementDraft,
      status: "confirmed",
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/ai/drafts/draft-1/confirm", {
        method: "POST",
      }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(confirmAiDraft).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        result: "failure",
        errorMessage: "AI draft is not pending",
      }),
    );
  });
});
