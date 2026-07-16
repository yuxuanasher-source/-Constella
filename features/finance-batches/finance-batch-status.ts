import type {
  FinanceBatchAction,
  FinanceBatchStatus,
} from "./finance-batch-types";

const transitions: Record<
  FinanceBatchAction,
  Partial<Record<FinanceBatchStatus, FinanceBatchStatus>>
> = {
  submit: { draft: "pending_review", reopened: "pending_review" },
  confirm: { pending_review: "confirmed" },
  lock: { confirmed: "locked" },
  export: { locked: "exported" },
  complete: { exported: "completed" },
  reject: { pending_review: "rejected" },
  reopen: { locked: "reopened", exported: "reopened", completed: "reopened" },
  void: {
    draft: "voided",
    pending_review: "voided",
    rejected: "voided",
    reopened: "voided",
  },
};

export function nextFinanceBatchStatus(
  status: FinanceBatchStatus,
  action: FinanceBatchAction,
): FinanceBatchStatus {
  const next = transitions[action][status];
  if (!next) {
    throw new Error(`Cannot ${action} finance batch from ${status}`);
  }

  return next;
}

export function assertFinanceBatchTransition(
  status: FinanceBatchStatus,
  action: FinanceBatchAction,
  options: { reason?: string } = {},
): void {
  if (
    (action === "reopen" || action === "void") &&
    !options.reason?.trim()
  ) {
    throw new Error("Finance batch transition reason is required");
  }

  nextFinanceBatchStatus(status, action);
}

export function assertFinanceBatchAdjustable(
  status: FinanceBatchStatus,
): void {
  if (["locked", "exported", "completed", "voided"].includes(status)) {
    throw new Error("Locked finance batches cannot be adjusted");
  }
}
