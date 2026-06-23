import { describe, expect, it } from "vitest";

import {
  assertCanResubmit,
  assertSubmissionTransition,
  isTerminalSubmissionStatus,
} from "./collaboration-submission-state";

describe("collaboration submission state machine", () => {
  it("allows the host one-trip review transitions", () => {
    expect(() =>
      assertSubmissionTransition("submitted", "under_review"),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition("under_review", "approved"),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition("submitted", "needs_changes"),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition("needs_changes", "submitted"),
    ).not.toThrow();
  });

  it("rejects transitions out of terminal states", () => {
    expect(() => assertSubmissionTransition("approved", "rejected")).toThrow(
      "Cannot move collaboration submission from approved to rejected",
    );
    expect(() => assertSubmissionTransition("rejected", "submitted")).toThrow();
  });

  it("only allows resubmission from needs_changes", () => {
    expect(() => assertCanResubmit("needs_changes")).not.toThrow();
    expect(() => assertCanResubmit("submitted")).toThrow(
      "Cannot resubmit collaboration submission while it is submitted",
    );
    expect(() => assertCanResubmit("approved")).toThrow();
  });

  it("flags approved and rejected as terminal", () => {
    expect(isTerminalSubmissionStatus("approved")).toBe(true);
    expect(isTerminalSubmissionStatus("rejected")).toBe(true);
    expect(isTerminalSubmissionStatus("submitted")).toBe(false);
  });
});
