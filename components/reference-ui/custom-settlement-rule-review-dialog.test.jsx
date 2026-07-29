import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CustomSettlementRuleReviewDialog from "./custom-settlement-rule-review-dialog";

const CREATOR_ID = "22222222-2222-4222-8222-222222222222";
const REVIEWER_ID = "66666666-6666-4666-8666-666666666666";
const RULE_ID = "44444444-4444-4444-8444-444444444444";
const FORCE_ACK = "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK";

function reviewRule(overrides = {}) {
  return {
    id: RULE_ID,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    versionNumber: 3,
    status: "pending_review",
    createdBy: CREATOR_ID,
    effectiveFrom: "2099-07-20T00:00:00.000Z",
    effectiveUntil: null,
    reason: "提交审核",
    primaryAction: { state: "pending_review", action: "approve" },
    ...overrides,
  };
}

function reviewSummary(overrides = {}) {
  return {
    contractDiff: [
      { field: "parameters", before: "每小时 ¥80.00", after: "每小时 ¥100.00" },
    ],
    largestDelta: { label: "主播小夏", amountYuan: "120.00" },
    missingDataBehavior: "缺少数据时转人工复核",
    risk: "影响金额超过阈值",
    creatorName: "运营小周",
    simulationFreshness: "fresh",
    ...overrides,
  };
}

describe("CustomSettlementRuleReviewDialog", () => {
  it("can be dismissed with the close button and Escape", () => {
    const close = vi.fn();
    const { rerender } = render(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule()}
        summary={reviewSummary()}
        currentUser={{ id: REVIEWER_ID, role: "ops_manager" }}
        onClose={close}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭审核弹窗" }));
    expect(close).toHaveBeenCalledTimes(1);

    rerender(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule()}
        summary={reviewSummary()}
        currentUser={{ id: REVIEWER_ID, role: "ops_manager" }}
        onClose={close}
      />,
    );
    fireEvent.keyDown(screen.getByRole("dialog", { name: "规则审核" }), {
      key: "Escape",
    });

    expect(close).toHaveBeenCalledTimes(2);
  });

  it("shows review evidence and distinct derived lifecycle labels", () => {
    render(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule()}
        summary={reviewSummary()}
        currentUser={{ id: REVIEWER_ID, role: "ops_manager" }}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "规则审核" });
    expect(dialog).toHaveTextContent("主播应付");
    expect(dialog).toHaveTextContent("当前项目");
    expect(dialog).toHaveTextContent("每小时 ¥80.00");
    expect(dialog).toHaveTextContent("每小时 ¥100.00");
    expect(dialog).toHaveTextContent("最大差异：主播小夏 ¥120.00");
    expect(dialog).toHaveTextContent("缺少数据时转人工复核");
    expect(dialog).toHaveTextContent("影响金额超过阈值");
    expect(dialog).toHaveTextContent("创建人：运营小周");
    expect(dialog).toHaveTextContent("试算新鲜");
    expect(dialog).toHaveTextContent("未来生效");

    render(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule({
          status: "active",
          effectiveFrom: "2026-07-01T00:00:00.000Z",
          effectiveUntil: "2026-07-31T23:59:59.000Z",
        })}
        summary={reviewSummary()}
        currentUser={{ id: REVIEWER_ID, role: "owner" }}
      />,
    );
    expect(screen.getByText("当前生效，已设置结束区间")).toBeInTheDocument();

    render(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule({
          status: "archived",
          effectiveFrom: "2026-06-01T00:00:00.000Z",
          effectiveUntil: "2026-06-30T23:59:59.000Z",
          archivedAt: "2026-07-01T00:00:00.000Z",
        })}
        summary={reviewSummary()}
        currentUser={{ id: REVIEWER_ID, role: "owner" }}
      />,
    );
    expect(screen.getByText("已结束归档")).toBeInTheDocument();
  });

  it("requires reasons, requires request-change comments, and blocks creator self approval", () => {
    const approve = vi.fn();
    const requestChanges = vi.fn();
    render(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule()}
        summary={reviewSummary()}
        currentUser={{ id: CREATOR_ID, role: "ops_manager" }}
        eligibleApproverId={REVIEWER_ID}
        onApprove={approve}
        onRequestChanges={requestChanges}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "确认生效" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("需由其他审核人确认生效")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "要求修改" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("审核原因"), {
      target: { value: "需补充口径" },
    });
    expect(screen.getByRole("button", { name: "要求修改" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("修改意见"), {
      target: { value: "请补充异常场次的处理方式" },
    });
    fireEvent.click(screen.getByRole("button", { name: "要求修改" }));

    expect(requestChanges).toHaveBeenCalledWith({
      ruleVersionId: RULE_ID,
      reason: "需补充口径",
      comment: "请补充异常场次的处理方式",
    });
    expect(approve).not.toHaveBeenCalled();
  });

  it("makes force approval visibly distinct, owner-only, and acknowledgment-gated", () => {
    const approve = vi.fn();
    const { rerender } = render(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule()}
        summary={reviewSummary()}
        currentUser={{ id: REVIEWER_ID, role: "ops_manager" }}
        onApprove={approve}
      />,
    );

    expect(screen.queryByText("强制确认")).not.toBeInTheDocument();

    rerender(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule()}
        summary={reviewSummary()}
        currentUser={{ id: REVIEWER_ID, role: "owner" }}
        onApprove={approve}
      />,
    );

    const forcePanel = screen.getByRole("region", { name: "强制确认" });
    expect(forcePanel).toHaveAttribute("data-force-review", "true");
    expect(screen.getByRole("button", { name: "强制确认生效" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("审核原因"), {
      target: { value: "单负责人承担风险" },
    });
    fireEvent.change(screen.getByLabelText("强制确认口令"), {
      target: { value: FORCE_ACK },
    });
    fireEvent.click(screen.getByRole("button", { name: "强制确认生效" }));

    expect(approve).toHaveBeenCalledWith({
      ruleVersionId: RULE_ID,
      effectiveFrom: "2099-07-20T00:00:00.000Z",
      reason: "单负责人承担风险",
      force: true,
      acknowledgment: FORCE_ACK,
    });
  });

  it("focuses dialog errors after a failed review transition", () => {
    render(
      <CustomSettlementRuleReviewDialog
        open
        rule={reviewRule()}
        summary={reviewSummary()}
        currentUser={{ id: REVIEWER_ID, role: "ops_manager" }}
        error="审核状态已变化，请刷新后重试"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("审核状态已变化，请刷新后重试");
    expect(alert).toHaveFocus();
  });
});
