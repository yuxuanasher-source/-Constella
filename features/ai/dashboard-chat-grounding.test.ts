import { describe, expect, it } from "vitest";

import type { RoleHomeDashboardDto } from "@/features/dashboards/role-home";
import type { AuthContext } from "@/lib/auth/context";
import { buildDashboardChatGrounding } from "./dashboard-chat-grounding";

const auth: AuthContext = {
  userId: "user-1",
  email: "ops@example.com",
  name: "运营负责人",
  organizationId: "org-1",
  organizationName: "星耀",
  role: "ops_manager",
};

describe("dashboard chat grounding", () => {
  it("turns role dashboard data into cited business facts", () => {
    const dashboard: RoleHomeDashboardDto = {
      profile: {
        role: "ops_manager",
        title: "经营总览看板",
        subtitle: "经营闭环",
        scopeLabel: "全组织",
      },
      kpis: [
        { key: "activeProjects", label: "进行中项目", value: 3, unit: "个" },
        { key: "receivable", label: "本月厂家应收", value: 240, unit: "元" },
      ],
      queue: [
        {
          key: "pendingReports",
          title: "待审核报数",
          subtitle: "2 条需要处理",
          tone: "amber",
          target: { route: "reports" },
        },
      ],
      risks: [
        {
          key: "highRiskProject",
          title: "高风险项目",
          subtitle: "1 个项目需要复核",
          tone: "red",
          target: { route: "projects", id: "project-1" },
        },
      ],
      drilldowns: [],
      panels: {
        projectRanking: {
          title: "低毛利项目",
          rows: [
            {
              key: "project-1",
              title: "王者荣耀代播",
              value: 12,
              hint: "毛利率偏低",
              tone: "amber",
              target: { route: "project", id: "project-1" },
            },
          ],
        },
      },
      generatedAt: "2026-06-28T01:20:00.000Z",
    };

    const grounding = buildDashboardChatGrounding({ dashboard, auth });

    expect(grounding.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "进行中项目",
          value: "3 个",
          source: "dashboard.kpis.activeProjects",
        }),
        expect.objectContaining({
          label: "本月厂家应收",
          value: "240 元",
          source: "dashboard.kpis.receivable",
        }),
        expect.objectContaining({
          label: "待审核报数",
          detail: "2 条需要处理",
          source: "dashboard.queue.pendingReports",
        }),
        expect.objectContaining({
          label: "高风险项目",
          detail: "1 个项目需要复核",
          source: "dashboard.risks.highRiskProject",
        }),
        expect.objectContaining({
          label: "低毛利项目：王者荣耀代播",
          value: "12",
          source: "dashboard.panels.projectRanking.project-1",
        }),
      ]),
    );
    expect(grounding.missingData).not.toContain("当前看板没有可用 KPI 事实");
    expect(grounding.promptText).toContain("真实业务事实包");
    expect(grounding.promptText).toContain("dashboard.kpis.receivable");
    expect(grounding.promptText).toContain("不得编造 facts 中不存在的数字");
  });

  it("marks missing data when the dashboard has no usable facts", () => {
    const dashboard: RoleHomeDashboardDto = {
      profile: {
        role: "ops_manager",
        title: "经营总览看板",
        subtitle: "经营闭环",
        scopeLabel: "全组织",
      },
      kpis: [],
      queue: [],
      risks: [],
      drilldowns: [],
      emptyState: {
        title: "暂无经营数据",
        hint: "创建项目后会出现经营指标",
      },
      generatedAt: "2026-06-28T01:20:00.000Z",
    };

    const grounding = buildDashboardChatGrounding({ dashboard, auth });

    expect(grounding.facts).toEqual([]);
    expect(grounding.missingData).toEqual(
      expect.arrayContaining([
        "当前看板没有可用 KPI 事实",
        "当前看板没有待办或风险事实",
        "暂无经营数据：创建项目后会出现经营指标",
      ]),
    );
    expect(grounding.promptText).toContain("缺失数据");
  });
});
