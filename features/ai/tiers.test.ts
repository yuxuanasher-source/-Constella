import { describe, expect, it } from "vitest";

import {
  aiAttemptTransition,
  aiAttemptTransitionFor,
  assertRegistrableTool,
  findStateMeta,
  isForbiddenTier,
  STATE_MACHINE_META,
} from "./tiers";

describe("AI tier safety foundation", () => {
  it("never lets AI directly reach forbidden (L4) states — only drafts", () => {
    for (const state of ["confirmed", "locked", "reopened"]) {
      const decision = aiAttemptTransitionFor("settlement", state);
      expect(decision.decision).toBe("draft_only");
      expect(decision.tier).toBe("L4_FORBIDDEN");
    }
    expect(aiAttemptTransitionFor("report", "enter_settlement_pool").decision).toBe(
      "draft_only",
    );
    expect(aiAttemptTransitionFor("onboarding", "joined").decision).toBe(
      "draft_only",
    );
  });

  it("stops at pending confirmation when the target state requires human confirm", () => {
    const decision = aiAttemptTransitionFor("settlement", "pending_confirm");
    expect(decision.decision).toBe("pending_confirmation");
    expect(decision.tier).toBe("L3_BOUNDED");
  });

  it("executes only reversible low-risk states that need no confirmation", () => {
    const decision = aiAttemptTransitionFor("settlement", "draft");
    expect(decision.decision).toBe("execute");
    expect(decision.tier).toBe("L2_DRAFT");
  });

  it("safely defaults unknown target states to pending confirmation, never execute", () => {
    const decision = aiAttemptTransition(findStateMeta("settlement", "made_up"));
    expect(decision.decision).toBe("pending_confirmation");
    expect(decision.tier).toBe("unknown");
  });

  it("treats frozen evidence colors as forbidden for AI", () => {
    for (const color of ["green", "yellow", "red"]) {
      const m = findStateMeta("report", color);
      expect(m?.tier).toBe("L4_FORBIDDEN");
      expect(m?.isFrozen).toBe(true);
      expect(aiAttemptTransition(m).decision).toBe("draft_only");
    }
  });

  it("flags financial impact + frozen semantics on settlement confirmation", () => {
    const m = findStateMeta("settlement", "confirmed");
    expect(m?.financialImpact).toBe(true);
    expect(m?.isFrozen).toBe(true);
    expect(m?.requiresHumanConfirm).toBe(true);
  });

  it("marks reopen as high-risk audit", () => {
    expect(findStateMeta("settlement", "reopened")?.highRiskAudit).toBe(true);
  });

  it("refuses to register any tool that declares the forbidden tier", () => {
    expect(() => assertRegistrableTool("confirm_settlement", "L4_FORBIDDEN")).toThrow(
      /never be registered/,
    );
    expect(() => assertRegistrableTool("ocr_extract", "L1_PERCEIVE")).not.toThrow();
    expect(() => assertRegistrableTool("draft_batch", "L2_DRAFT")).not.toThrow();
    expect(isForbiddenTier("L4_FORBIDDEN")).toBe(true);
    expect(isForbiddenTier("L3_BOUNDED")).toBe(false);
  });

  it("keeps state metadata internally consistent (L4 covers all frozen/financial states)", () => {
    for (const m of STATE_MACHINE_META) {
      // 带资金后果或冻结语义的状态必须是 L4 禁区。
      if (m.financialImpact || m.isFrozen) {
        expect(m.tier).toBe("L4_FORBIDDEN");
      }
    }
  });
});
