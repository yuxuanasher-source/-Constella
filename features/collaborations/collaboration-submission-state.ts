export const collaborationSubmissionStatuses = [
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "needs_changes",
] as const;

export type CollaborationSubmissionStatus =
  (typeof collaborationSubmissionStatuses)[number];

const allowedSubmissionTransitions: Record<
  CollaborationSubmissionStatus,
  CollaborationSubmissionStatus[]
> = {
  submitted: ["under_review", "approved", "rejected", "needs_changes"],
  under_review: ["approved", "rejected", "needs_changes"],
  needs_changes: ["submitted", "rejected"],
  rejected: [],
  approved: [],
};

export function assertSubmissionTransition(
  from: CollaborationSubmissionStatus,
  to: CollaborationSubmissionStatus,
): void {
  if (!allowedSubmissionTransitions[from]?.includes(to)) {
    throw new Error(`Cannot move collaboration submission from ${from} to ${to}`);
  }
}

// 乙方仅能在以下状态重新提交内容
const resubmittableStatuses = new Set<CollaborationSubmissionStatus>([
  "needs_changes",
]);

export function assertCanResubmit(
  status: CollaborationSubmissionStatus,
): void {
  if (!resubmittableStatuses.has(status)) {
    throw new Error(
      `Cannot resubmit collaboration submission while it is ${status}`,
    );
  }
}

export type CollaborationReviewDecision =
  | "under_review"
  | "approved"
  | "rejected"
  | "needs_changes";

export function isTerminalSubmissionStatus(
  status: CollaborationSubmissionStatus,
): boolean {
  return status === "approved" || status === "rejected";
}
