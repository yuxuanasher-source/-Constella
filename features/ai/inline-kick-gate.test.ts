import { describe, expect, it } from "vitest";

import {
  releaseInlineKickSlot,
  resolveInlineKickLimit,
  tryAcquireInlineKickSlot,
} from "./inline-kick-gate";

describe("inline kick gate", () => {
  it("grants slots up to the limit and rejects beyond it", () => {
    const gate = "test-gate-limit";
    expect(tryAcquireInlineKickSlot(gate, 2)).toBe(true);
    expect(tryAcquireInlineKickSlot(gate, 2)).toBe(true);
    expect(tryAcquireInlineKickSlot(gate, 2)).toBe(false);
    releaseInlineKickSlot(gate);
    releaseInlineKickSlot(gate);
  });

  it("frees the slot on release so later kicks recover", () => {
    const gate = "test-gate-release";
    expect(tryAcquireInlineKickSlot(gate, 1)).toBe(true);
    expect(tryAcquireInlineKickSlot(gate, 1)).toBe(false);
    releaseInlineKickSlot(gate);
    expect(tryAcquireInlineKickSlot(gate, 1)).toBe(true);
    releaseInlineKickSlot(gate);
  });

  it("treats a zero or negative limit as fully disabled", () => {
    const gate = "test-gate-disabled";
    expect(tryAcquireInlineKickSlot(gate, 0)).toBe(false);
    expect(tryAcquireInlineKickSlot(gate, -1)).toBe(false);
  });

  it("keeps counters independent per gate name", () => {
    const a = "test-gate-a";
    const b = "test-gate-b";
    expect(tryAcquireInlineKickSlot(a, 1)).toBe(true);
    expect(tryAcquireInlineKickSlot(b, 1)).toBe(true);
    releaseInlineKickSlot(a);
    releaseInlineKickSlot(b);
  });

  it("does not underflow when released more times than acquired", () => {
    const gate = "test-gate-underflow";
    releaseInlineKickSlot(gate);
    expect(tryAcquireInlineKickSlot(gate, 1)).toBe(true);
    releaseInlineKickSlot(gate);
  });

  describe("resolveInlineKickLimit", () => {
    it("falls back when unset or blank", () => {
      expect(resolveInlineKickLimit(undefined, 3)).toBe(3);
      expect(resolveInlineKickLimit("", 3)).toBe(3);
      expect(resolveInlineKickLimit("   ", 3)).toBe(3);
    });

    it("falls back on non-integer or negative values", () => {
      expect(resolveInlineKickLimit("abc", 3)).toBe(3);
      expect(resolveInlineKickLimit("1.5", 3)).toBe(3);
      expect(resolveInlineKickLimit("-2", 3)).toBe(3);
    });

    it("accepts explicit zero as fully disabled", () => {
      expect(resolveInlineKickLimit("0", 3)).toBe(0);
    });

    it("accepts a valid integer override", () => {
      expect(resolveInlineKickLimit("5", 1)).toBe(5);
    });
  });
});
