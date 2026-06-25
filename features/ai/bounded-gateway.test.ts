import { describe, expect, it, vi } from "vitest";

import {
  generateRejectionReason,
  rankReportQueue,
  type ReportQueueItem,
} from "./bounded-actions";
import { runAiBoundedTransition, type BoundedDeps } from "./bounded-gateway";

const actor = {
  userId: "u1",
  name: "Ops",
  role: "ops_manager",
  organizationId: "org-1",
};

function makeDeps(): BoundedDeps<{ ok: true }> & {
  execute: ReturnType<typeof vi.fn>;
  createPending: ReturnType<typeof vi.fn>;
  createDraft: ReturnType<typeof vi.fn>;
} {
  return {
    execute: vi.fn(async () => ({ ok: true as const })),
    createPending: vi.fn(async () => ({ id: "pending-1" })),
    createDraft: vi.fn(async () => ({ id: "draft-1" })),
  };
}

describe("runAiBoundedTransition (state-change gateway)", () => {
  it("executes reversible low-risk L3 actions (and never drafts/pends)", async () => {
    const deps = makeDeps();
    const out = await runAiBoundedTransition(
      { stateMachine: "task", targetState: "abnormal_ticket", actionType: "exception_ticket", payload: {} },
      actor,
      deps,
    );
    expect(out.outcome).toBe("executed");
    expect(deps.execute).toHaveBeenCalledTimes(1);
    expect(deps.createPending).not.toHaveBeenCalled();
    expect(deps.createDraft).not.toHaveBeenCalled();
  });

  it("stops at pending confirmation when the target state requires it — without executing", async () => {
    const deps = makeDeps();
    const out = await runAiBoundedTransition(
      { stateMachine: "task", targetState: "cancelled", actionType: "cancel_task", payload: {} },
      actor,
      deps,
    );
    expect(out.outcome).toBe("pending_confirmation");
    expect(deps.createPending).toHaveBeenCalledTimes(1);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("only drafts for L4 targets — execute and pending are never reached", async () => {
    const deps = makeDeps();
    const out = await runAiBoundedTransition(
      { stateMachine: "settlement", targetState: "confirmed", actionType: "confirm_settlement", payload: {} },
      actor,
      deps,
    );
    expect(out.outcome).toBe("draft_only");
    expect(deps.createDraft).toHaveBeenCalledTimes(1);
    expect(deps.execute).not.toHaveBeenCalled();
    expect(deps.createPending).not.toHaveBeenCalled();
  });

  it("safely defaults unknown target states to pending confirmation, never execute", async () => {
    const deps = makeDeps();
    const out = await runAiBoundedTransition(
      { stateMachine: "mystery", targetState: "???", actionType: "x", payload: {} },
      actor,
      deps,
    );
    expect(out.outcome).toBe("pending_confirmation");
    expect(deps.execute).not.toHaveBeenCalled();
  });
});

describe("rankReportQueue (L3 初筛排序)", () => {
  const items: ReportQueueItem[] = [
    { id: "a", evidenceLevel: "green", submittedAt: "2026-06-02T09:00:00Z" },
    { id: "b", evidenceLevel: "red", submittedAt: "2026-06-02T10:00:00Z" },
    { id: "c", evidenceLevel: "yellow", deviationPct: 26, submittedAt: "2026-06-02T08:00:00Z" },
    { id: "d", evidenceLevel: "green", riskLevel: "blacklisted", submittedAt: "2026-06-02T07:00:00Z" },
  ];

  it("puts suspicious reports at the top and green on the fast lane", () => {
    const ranked = rankReportQueue(items);
    expect(ranked[0].id).toBe("d"); // blacklisted first
    expect(ranked[ranked.length - 1].lane).toBe("fast");
    expect(ranked.find((r) => r.id === "a")?.lane).toBe("fast");
    expect(ranked.find((r) => r.id === "b")?.lane).toBe("review");
  });
});

describe("generateRejectionReason (L3 打回理由)", () => {
  it("derives structured reasons from evidence flags", () => {
    const r = generateRejectionReason({
      evidenceLevel: "yellow",
      riskFlags: ["missing_screenshot_duration"],
    });
    expect(r.codes).toContain("missing_screenshot_duration");
    expect(r.reasons.join("")).toContain("截图");
    expect(r.suggestion).toContain("补传");
  });

  it("flags divergence when deviation exceeds threshold", () => {
    const r = generateRejectionReason({ evidenceLevel: "yellow", deviationPct: 25 });
    expect(r.codes).toContain("duration_divergence");
  });
});
