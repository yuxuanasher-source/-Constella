import { describe, expect, it } from "vitest";

import {
  isTerminalTaskStatus,
  normalizeTaskPriority,
  TERMINAL_TASK_STATUSES,
} from "./contracts";

describe("async task contracts", () => {
  it("treats succeeded, failed, and cancelled as terminal statuses", () => {
    expect(isTerminalTaskStatus("succeeded")).toBe(true);
    expect(isTerminalTaskStatus("failed")).toBe(true);
    expect(isTerminalTaskStatus("cancelled")).toBe(true);
    expect(TERMINAL_TASK_STATUSES).toEqual(
      new Set(["succeeded", "failed", "cancelled"]),
    );
  });

  it("treats queued, running, and needs_confirmation as active statuses", () => {
    expect(isTerminalTaskStatus("queued")).toBe(false);
    expect(isTerminalTaskStatus("running")).toBe(false);
    expect(isTerminalTaskStatus("needs_confirmation")).toBe(false);
  });

  it("normalizes task priority into the stable 0 to 3 range", () => {
    expect(normalizeTaskPriority(-1)).toBe(0);
    expect(normalizeTaskPriority(0)).toBe(0);
    expect(normalizeTaskPriority(1)).toBe(1);
    expect(normalizeTaskPriority(2)).toBe(2);
    expect(normalizeTaskPriority(3)).toBe(3);
    expect(normalizeTaskPriority(4)).toBe(3);
  });

  it("rejects invalid task priorities instead of silently guessing", () => {
    expect(() => normalizeTaskPriority("1")).toThrow(/Invalid task priority/);
    expect(() => normalizeTaskPriority(1.5)).toThrow(/Invalid task priority/);
    expect(() => normalizeTaskPriority(Number.NaN)).toThrow(
      /Invalid task priority/,
    );
  });
});
