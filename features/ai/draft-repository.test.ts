import { describe, expect, it, vi } from "vitest";

import {
  confirmAiDraft,
  getAiDraftForConfirmation,
  type DraftClient,
} from "./draft-repository";

describe("AI draft repository confirmation gateway", () => {
  it("loads the draft before confirmation so the route can evaluate the gateway", async () => {
    const row = {
      id: "draft-1",
      draft_type: "settlement_batch",
      target_state_machine: "settlement",
      target_state: "confirmed",
      payload: { totals: { itemCount: 2 } },
      status: "pending",
      acting_user_id: "ai-user",
      confirmed_by: null,
      created_at: "2026-06-28T00:00:00.000Z",
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const eqOrganization = vi.fn(() => ({ maybeSingle }));
    const eqId = vi.fn(() => ({ eq: eqOrganization }));
    const select = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ select }));

    const draft = await getAiDraftForConfirmation(
      { from } as unknown as DraftClient,
      { organizationId: "org-1", draftId: "draft-1" },
    );

    expect(from).toHaveBeenCalledWith("ai_drafts");
    expect(eqId).toHaveBeenCalledWith("id", "draft-1");
    expect(eqOrganization).toHaveBeenCalledWith("organization_id", "org-1");
    expect(draft).toMatchObject({
      id: "draft-1",
      draftType: "settlement_batch",
      targetStateMachine: "settlement",
      targetState: "confirmed",
      status: "pending",
    });
  });

  it("confirms only pending drafts and reports whether a row transitioned", async () => {
    const returns = vi.fn().mockResolvedValue({ data: [{ id: "draft-1" }], error: null });
    const select = vi.fn(() => ({ returns }));
    const eqStatus = vi.fn(() => ({ select }));
    const eqOrganization = vi.fn(() => ({ eq: eqStatus }));
    const eqId = vi.fn(() => ({ eq: eqOrganization }));
    const update = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ update }));

    const ok = await confirmAiDraft(
      { from } as unknown as DraftClient,
      { organizationId: "org-1", draftId: "draft-1", confirmedBy: "user-1" },
    );

    expect(eqStatus).toHaveBeenCalledWith("status", "pending");
    expect(select).toHaveBeenCalledWith("id");
    expect(ok).toBe(true);
  });

  it("returns false when no pending row transitions", async () => {
    const returns = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn(() => ({ returns }));
    const eqStatus = vi.fn(() => ({ select }));
    const eqOrganization = vi.fn(() => ({ eq: eqStatus }));
    const eqId = vi.fn(() => ({ eq: eqOrganization }));
    const update = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ update }));

    const ok = await confirmAiDraft(
      { from } as unknown as DraftClient,
      { organizationId: "org-1", draftId: "draft-1", confirmedBy: "user-1" },
    );

    expect(ok).toBe(false);
  });
});
