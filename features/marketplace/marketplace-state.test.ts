import { describe, expect, it } from "vitest";

import {
  canConfirmDeal,
  canResubmit,
  canReview,
  canWithdraw,
  isTerminalApplication,
  postingAcceptsApplications,
  reviewTarget,
} from "./marketplace-state";

describe("marketplace review state machine", () => {
  it("maps review actions to target states", () => {
    expect(reviewTarget("start_review")).toBe("under_review");
    expect(reviewTarget("approve")).toBe("approved");
    expect(reviewTarget("reject")).toBe("rejected");
    expect(reviewTarget("request_more")).toBe("need_more");
    // @ts-expect-error 非法动作
    expect(reviewTarget("bogus")).toBeNull();
  });

  it("only allows review from submitted / under_review / need_more", () => {
    expect(canReview("submitted", "approve")).toBe(true);
    expect(canReview("under_review", "reject")).toBe(true);
    expect(canReview("need_more", "request_more")).toBe(true);
    expect(canReview("approved", "reject")).toBe(false);
    expect(canReview("deal_confirmed", "approve")).toBe(false);
    expect(canReview("rejected", "approve")).toBe(false);
  });

  it("gates resubmit / withdraw / confirm-deal correctly", () => {
    expect(canResubmit("draft")).toBe(true);
    expect(canResubmit("need_more")).toBe(true);
    expect(canResubmit("submitted")).toBe(false);

    expect(canWithdraw("submitted")).toBe(true);
    expect(canWithdraw("under_review")).toBe(true);
    expect(canWithdraw("deal_confirmed")).toBe(false);

    expect(canConfirmDeal("approved")).toBe(true);
    expect(canConfirmDeal("submitted")).toBe(false);
    expect(canConfirmDeal("under_review")).toBe(false);
  });

  it("only open postings accept applications", () => {
    expect(postingAcceptsApplications("open")).toBe(true);
    expect(postingAcceptsApplications("draft")).toBe(false);
    expect(postingAcceptsApplications("matched")).toBe(false);
    expect(postingAcceptsApplications("closed")).toBe(false);
  });

  it("marks terminal application states", () => {
    expect(isTerminalApplication("rejected")).toBe(true);
    expect(isTerminalApplication("withdrawn")).toBe(true);
    expect(isTerminalApplication("deal_confirmed")).toBe(true);
    expect(isTerminalApplication("approved")).toBe(false);
    expect(isTerminalApplication("submitted")).toBe(false);
  });
});
