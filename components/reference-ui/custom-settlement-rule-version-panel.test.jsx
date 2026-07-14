import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CustomSettlementRuleVersionPanel from "./custom-settlement-rule-version-panel";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const REVIEWER_ID = "66666666-6666-4666-8666-666666666666";
const RULE_ID = "44444444-4444-4444-8444-444444444444";

function rule(overrides = {}) {
  return {
    id: RULE_ID,
    projectId: "33333333-3333-4333-8333-333333333333",
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    priority: 100,
    versionNumber: 2,
    status: "active",
    formulaHash: "a".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: "c".repeat(64),
    catalogHash: "d".repeat(64),
    dataSelectionHash: "e".repeat(64),
    simulationId: "55555555-5555-4555-8555-555555555555",
    effectiveFrom: "2026-07-12T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: USER_ID,
    approvedBy: REVIEWER_ID,
    aiDraftId: null,
    reason: "审核通过",
    createdAt: "2026-07-12T00:00:00.000Z",
    approvedAt: "2026-07-12T01:00:00.000Z",
    archivedAt: null,
    primaryAction: { state: "active", action: "create_new_version" },
    ...overrides,
  };
}

function template(overrides = {}) {
  return {
    kind: "organization",
    id: "template-1",
    name: "按小时结算模板",
    description: "复用当前机构常用主播计费方式",
    sourceRuleVersionId: RULE_ID,
    sourceProjectId: "33333333-3333-4333-8333-333333333333",
    sourceVersionNumber: 2,
    sourceScope: "payable",
    executionGrain: "report",
    compositionMode: "replace",
    parameters: [
      { key: "hourly_rate", labelZh: "每小时单价", type: "money_yuan", value: 100 },
      { key: "bonus_rate", labelZh: "达标奖励", type: "percent", value: 12.5 },
    ],
    contract: {
      title: "项目主播按小时结算",
      summary: "按系统直播时长计算主播应付金额。",
    },
    status: "active",
    createdBy: USER_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    archivedAt: null,
    readOnly: false,
    ...overrides,
  };
}

function expectOnePrimary(name) {
  const primary = document.querySelectorAll('[data-primary-action="true"]');
  expect(primary).toHaveLength(1);
  expect(primary[0]).toHaveAccessibleName(name);
}

describe("CustomSettlementRuleVersionPanel", () => {
  it.each([
    [{ kind: "unresolved" }, [], "回复 AI"],
    [{ kind: "contract_ready" }, [], "确认业务规则并试算"],
    [{ kind: "simulated", role: "owner" }, [], "应用并提交审核"],
    [{ kind: "simulated", role: "operator_business" }, [], "保存并请求审核"],
    [
      null,
      [
        rule({
          status: "pending_review",
          createdBy: USER_ID,
          eligibleApproverId: REVIEWER_ID,
          requiresDifferentApprover: true,
          primaryAction: { state: "pending_review", action: "approve" },
        }),
      ],
      "确认生效",
    ],
    [
      null,
      [
        rule({
          status: "changes_requested",
          primaryAction: {
            state: "changes_requested",
            action: "revise_and_resimulate",
          },
        }),
      ],
      "修改并重新试算",
    ],
    [
      null,
      [
        rule({
          status: "draft",
          primaryAction: { state: "draft", action: "apply_and_submit" },
        }),
      ],
      "应用并提交审核",
    ],
    [null, [rule()], "创建新版本"],
  ])("maps %s to exactly one primary action %s", (buildState, versions, label) => {
    render(
      <CustomSettlementRuleVersionPanel
        buildState={buildState}
        versions={versions}
        currentUser={{ id: REVIEWER_ID, role: "owner" }}
        templates={[]}
      />,
    );

    expectOnePrimary(label);
  });

  it("uses server primary action and approver eligibility before showing approval", () => {
    render(
      <CustomSettlementRuleVersionPanel
        versions={[
          rule({
            status: "pending_review",
            createdBy: USER_ID,
            eligibleApproverId: REVIEWER_ID,
            requiresDifferentApprover: true,
            primaryAction: { state: "pending_review", action: "none" },
          }),
        ]}
        currentUser={{ id: REVIEWER_ID, role: "ops_manager" }}
        templates={[]}
      />,
    );

    expect(screen.queryByRole("button", { name: "确认生效" })).not.toBeInTheDocument();

    const { rerender } = render(
      <CustomSettlementRuleVersionPanel
        versions={[
          rule({
            status: "pending_review",
            createdBy: USER_ID,
            eligibleApproverId: REVIEWER_ID,
            requiresDifferentApprover: true,
            primaryAction: { state: "pending_review", action: "approve" },
          }),
        ]}
        currentUser={{ id: USER_ID, role: "ops_manager" }}
        templates={[]}
      />,
    );

    expect(screen.queryByRole("button", { name: "确认生效" })).not.toBeInTheDocument();

    rerender(
      <CustomSettlementRuleVersionPanel
        versions={[
          rule({
            status: "pending_review",
            createdBy: USER_ID,
            eligibleApproverId: REVIEWER_ID,
            requiresDifferentApprover: true,
            primaryAction: { state: "pending_review", action: "approve" },
          }),
        ]}
        currentUser={{ id: REVIEWER_ID, role: "ops_manager" }}
        templates={[]}
      />,
    );

    expectOnePrimary("确认生效");
  });

  it("reopens a changes-requested version as a draft before revision", () => {
    const reopen = vi.fn();
    render(
      <CustomSettlementRuleVersionPanel
        versions={[
          rule({
            status: "changes_requested",
            primaryAction: {
              state: "changes_requested",
              action: "revise_and_resimulate",
            },
          }),
        ]}
        currentUser={{ id: USER_ID, role: "ops_manager" }}
        templates={[]}
        onReopenDraft={reopen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "修改并重新试算" }));

    expect(reopen).toHaveBeenCalledWith(RULE_ID);
  });

  it("dispatches active versions through the create-new-version primary action", () => {
    const primaryAction = vi.fn();
    render(
      <CustomSettlementRuleVersionPanel
        versions={[rule()]}
        currentUser={{ id: USER_ID, role: "owner" }}
        templates={[]}
        onPrimaryAction={primaryAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建新版本" }));

    expect(primaryAction).toHaveBeenCalledWith("new_version", rule());
  });

  it("dispatches saved draft versions through the submit primary action", () => {
    const primaryAction = vi.fn();
    const draftRule = rule({
      status: "draft",
      primaryAction: { state: "draft", action: "apply_and_submit" },
    });
    render(
      <CustomSettlementRuleVersionPanel
        versions={[draftRule]}
        currentUser={{ id: USER_ID, role: "owner" }}
        templates={[]}
        onPrimaryAction={primaryAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "应用并提交审核" }));

    expect(primaryAction).toHaveBeenCalledWith("submit", draftRule);
  });

  it("shows system and organization templates, clones into editable draft, and formats parameter units", () => {
    const clone = vi.fn().mockReturnValue({
      rule: rule({ status: "draft", versionNumber: 3 }),
      missingTargetVariables: ["系统直播时长"],
    });
    render(
      <CustomSettlementRuleVersionPanel
        versions={[]}
        currentUser={{ id: USER_ID, role: "owner" }}
        templates={[
          {
            kind: "system",
            id: "system:hourly:v1",
            name: "系统按小时模板",
            description: "系统内置模板",
            contract: { title: "系统按小时", summary: "按小时计算。" },
            readOnly: true,
          },
          template(),
        ]}
        onCloneTemplate={clone}
      />,
    );

    expect(screen.getByText("系统模板")).toBeInTheDocument();
    expect(screen.getByText("机构模板")).toBeInTheDocument();
    const orgTemplate = screen.getByRole("group", { name: "按小时结算模板" });
    expect(orgTemplate).toHaveTextContent("¥100.00");
    expect(orgTemplate).toHaveTextContent("12.50%");
    expect(orgTemplate).not.toHaveTextContent(/amountCents|rateBps|10000|1250/u);
    expect(screen.getByTestId("reuse-advanced-formula")).not.toHaveAttribute(
      "open",
    );

    fireEvent.click(
      within(orgTemplate).getByRole("button", { name: "克隆为草稿" }),
    );

    expect(clone).toHaveBeenCalledWith("template-1");
    expect(screen.getByRole("heading", { name: "可编辑草稿" })).toBeInTheDocument();
    expect(screen.getByText("缺少目标数据：系统直播时长")).toBeInTheDocument();
  });
});
