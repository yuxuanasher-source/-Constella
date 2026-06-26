// 供需撮合论坛的状态机（纯函数，可单测）。需求文档第五.2 节资料审核状态机：
//   草稿 → 已投递 → 审核中 → 通过 / 驳回 / 补充 → 已达成。
// 撮合达成是「成交路径受控」的关键节点——只有发单方审核通过且接单方确认后才达成。

export type PostingStatus = "draft" | "open" | "matched" | "closed" | "expired";

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "need_more"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "deal_confirmed";

export type ReviewAction = "start_review" | "approve" | "reject" | "request_more";

// 发单方对投递可执行的审核动作 → 目标状态。
const REVIEW_TARGET: Record<ReviewAction, ApplicationStatus> = {
  start_review: "under_review",
  approve: "approved",
  reject: "rejected",
  request_more: "need_more",
};

// 审核动作的合法前置状态（已投递 / 审核中 / 待补充可被审核；通过/驳回/达成等为终态或已决）。
const REVIEWABLE_FROM: ApplicationStatus[] = ["submitted", "under_review", "need_more"];

export function reviewTarget(action: ReviewAction): ApplicationStatus | null {
  return REVIEW_TARGET[action] ?? null;
}

export function canReview(
  from: ApplicationStatus,
  action: ReviewAction,
): boolean {
  if (!REVIEW_TARGET[action]) return false;
  return REVIEWABLE_FROM.includes(from);
}

// 接单方可改自己投递：草稿/待补充可重投；非终态可撤回。
export function canResubmit(from: ApplicationStatus): boolean {
  return from === "draft" || from === "need_more";
}

export function canWithdraw(from: ApplicationStatus): boolean {
  return ["draft", "submitted", "under_review", "need_more"].includes(from);
}

// 达成确认：仅「通过」的投递可由接单方确认达成。
export function canConfirmDeal(from: ApplicationStatus): boolean {
  return from === "approved";
}

// 需求订单可被投递的状态：仅公开中可投。
export function postingAcceptsApplications(status: PostingStatus): boolean {
  return status === "open";
}

// 终态判定。
export function isTerminalApplication(status: ApplicationStatus): boolean {
  return ["rejected", "withdrawn", "deal_confirmed"].includes(status);
}
