import { describe, expect, it } from "vitest";

import {
  assertFinanceBatchAdjustable,
  assertFinanceBatchTransition,
  nextFinanceBatchStatus,
} from "./finance-batch-status";

describe("finance batch status guards", () => {
  it("allows the normal lock path", () => {
    expect(nextFinanceBatchStatus("draft", "submit")).toBe("pending_review");
    expect(nextFinanceBatchStatus("pending_review", "confirm")).toBe(
      "confirmed",
    );
    expect(nextFinanceBatchStatus("confirmed", "lock")).toBe("locked");
    expect(nextFinanceBatchStatus("locked", "export")).toBe("exported");
    expect(nextFinanceBatchStatus("exported", "complete")).toBe("completed");
  });

  it("allows review rejection and rejected voiding", () => {
    expect(nextFinanceBatchStatus("pending_review", "reject")).toBe(
      "rejected",
    );
    expect(nextFinanceBatchStatus("rejected", "void")).toBe("voided");
  });

  it("blocks invalid transitions", () => {
    expect(() => assertFinanceBatchTransition("draft", "lock")).toThrow(
      "Cannot lock finance batch from draft",
    );
    expect(() => assertFinanceBatchTransition("voided", "submit")).toThrow(
      "Cannot submit finance batch from voided",
    );
  });

  it("requires a nonblank reason for reopen and void actions", () => {
    expect(() =>
      assertFinanceBatchTransition("locked", "reopen"),
    ).toThrow("Finance batch transition reason is required");
    expect(() =>
      assertFinanceBatchTransition("draft", "void", { reason: "   " }),
    ).toThrow("Finance batch transition reason is required");

    expect(() =>
      assertFinanceBatchTransition("locked", "reopen", {
        reason: "Corrected source data",
      }),
    ).not.toThrow();
    expect(() =>
      assertFinanceBatchTransition("rejected", "void", {
        reason: "Duplicate batch",
      }),
    ).not.toThrow();
  });

  it("requires reopen before locked batch adjustment", () => {
    expect(() => assertFinanceBatchAdjustable("locked")).toThrow(
      "Locked finance batches cannot be adjusted",
    );
    expect(() => assertFinanceBatchAdjustable("exported")).toThrow(
      "Locked finance batches cannot be adjusted",
    );
    expect(() => assertFinanceBatchAdjustable("completed")).toThrow(
      "Locked finance batches cannot be adjusted",
    );
    expect(() => assertFinanceBatchAdjustable("voided")).toThrow(
      "Locked finance batches cannot be adjusted",
    );
    expect(() => assertFinanceBatchAdjustable("draft")).not.toThrow();
    expect(() => assertFinanceBatchAdjustable("reopened")).not.toThrow();
    expect(() => assertFinanceBatchAdjustable("pending_review")).not.toThrow();
    expect(() => assertFinanceBatchAdjustable("rejected")).not.toThrow();
    expect(() => assertFinanceBatchAdjustable("confirmed")).not.toThrow();
  });
});
