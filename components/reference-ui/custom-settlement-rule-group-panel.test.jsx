import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CustomSettlementRuleGroupPanel from "./custom-settlement-rule-group-panel";

const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const STREAMER_ID = "55555555-5555-4555-8555-555555555555";

function group(overrides = {}) {
  return {
    id: GROUP_ID,
    projectId: "33333333-3333-4333-8333-333333333333",
    name: "高优先级主播",
    description: "显式维护的结算分组",
    status: "active",
    createdBy: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-07-12T00:00:00.000Z",
    archivedAt: null,
    assignmentCount: 2,
    activeRuleCount: 1,
    pendingRuleCount: 0,
    futureAssignmentCount: 1,
    unassignedProjectStreamers: [
      {
        projectStreamerId: STREAMER_ID,
        streamerId: "66666666-6666-4666-8666-666666666666",
        displayName: "主播小夏",
      },
    ],
    baseRuleCoveredProjectStreamerIds: [],
    ...overrides,
  };
}

describe("CustomSettlementRuleGroupPanel", () => {
  it("renders explicit groups, membership counts, and unassigned streamers without profile-tag wording", () => {
    render(
      <CustomSettlementRuleGroupPanel
        groups={[group()]}
        streamers={[{ projectStreamerId: STREAMER_ID, displayName: "主播小夏" }]}
      />,
    );

    const panel = screen.getByRole("region", { name: "结算分组" });
    expect(panel).toHaveTextContent("高优先级主播");
    expect(panel).toHaveTextContent("成员 2 人");
    expect(panel).toHaveTextContent("生效规则 1 条");
    expect(panel).toHaveTextContent("未来分配 1 条");
    expect(panel).toHaveTextContent("未分组主播：主播小夏");
    expect(panel).toHaveTextContent("手动分配，非自动归类");
    expect(panel).not.toHaveTextContent(/标签|画像|自动匹配|profile-tag/i);
  });

  it("requires assignment effective time and reason before submitting", () => {
    const assign = vi.fn();
    render(
      <CustomSettlementRuleGroupPanel
        groups={[group()]}
        streamers={[{ projectStreamerId: STREAMER_ID, displayName: "主播小夏" }]}
        onAssign={assign}
      />,
    );

    expect(screen.getByRole("button", { name: "更新分组" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("主播"), {
      target: { value: STREAMER_ID },
    });
    fireEvent.change(screen.getByLabelText("分组"), {
      target: { value: GROUP_ID },
    });
    fireEvent.change(screen.getByLabelText("生效时间"), {
      target: { value: "2026-07-13T09:00" },
    });
    expect(screen.getByRole("button", { name: "更新分组" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("分配原因"), {
      target: { value: "按本月结算策略调整" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新分组" }));

    expect(assign).toHaveBeenCalledWith({
      projectStreamerId: STREAMER_ID,
      groupId: GROUP_ID,
      effectiveFrom: "2026-07-13T09:00",
      reason: "按本月结算策略调整",
    });
  });

  it("blocks submission when overlap or priority conflict exists", () => {
    const assign = vi.fn();
    render(
      <CustomSettlementRuleGroupPanel
        groups={[group({ pendingRuleCount: 2 })]}
        streamers={[{ projectStreamerId: STREAMER_ID, displayName: "主播小夏" }]}
        conflict={{
          type: "overlap_priority",
          message: "该主播在同一时间已有更高优先级分组规则",
        }}
        onAssign={assign}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("该主播在同一时间已有更高优先级分组规则");
    const form = screen.getByRole("form", { name: "调整分组" });
    fireEvent.change(within(form).getByLabelText("主播"), {
      target: { value: STREAMER_ID },
    });
    fireEvent.change(within(form).getByLabelText("分组"), {
      target: { value: GROUP_ID },
    });
    fireEvent.change(within(form).getByLabelText("生效时间"), {
      target: { value: "2026-07-13T09:00" },
    });
    fireEvent.change(within(form).getByLabelText("分配原因"), {
      target: { value: "按本月结算策略调整" },
    });

    expect(within(form).getByRole("button", { name: "更新分组" })).toBeDisabled();
    expect(assign).not.toHaveBeenCalled();
  });
});
