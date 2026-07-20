import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoleHomeDashboardDto } from "@/features/dashboards/role-home";

import { ConsoleAiWorkbench } from "./ai-workbench";

vi.mock("@/components/reference-ui/ai-usage-dashboard", () => ({
  default: vi.fn(() => <div data-testid="ai-usage-dashboard">usage</div>),
}));

const dashboardHome: RoleHomeDashboardDto = {
  profile: {
    role: "owner",
    title: "经营指挥盘",
    subtitle: "真实业务上下文",
    scopeLabel: "全组织",
  },
  kpis: [
    { key: "receivable", label: "本月应收", value: 12000, unit: "元" },
    { key: "gross", label: "预计毛利", value: 3800, unit: "元" },
  ],
  queue: [
    {
      key: "queue-1",
      title: "待处理项目",
      subtitle: "3 个项目需要跟进",
      tone: "blue",
      target: { route: "projects" },
    },
  ],
  risks: [
    {
      key: "risk-1",
      title: "高风险项目",
      subtitle: "低毛利需要复核",
      tone: "red",
      target: { route: "projects" },
    },
  ],
  drilldowns: [],
  generatedAt: "2026-07-20T01:00:00.000Z",
};

describe("ConsoleAiWorkbench", () => {
  it("renders the AI command surface with real dashboard context and usage telemetry", () => {
    render(
      <ConsoleAiWorkbench
        currentUser={{
          id: "user-ai",
          name: "AI Operator",
          role: "owner",
          org: "Demo Org",
        }}
        dashboardHome={dashboardHome}
        dashboardHomeError={null}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "M10 智能作战台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AI Operator")).toBeInTheDocument();
    expect(screen.getByText("全组织")).toBeInTheDocument();
    expect(screen.getByText("高风险项目")).toBeInTheDocument();
    expect(screen.getByText("待处理项目")).toBeInTheDocument();
    expect(screen.getByText("本月应收")).toBeInTheDocument();
    expect(screen.getByTestId("ai-usage-dashboard")).toBeInTheDocument();
    expect(screen.getAllByText("人工确认").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("确认生成")).not.toBeInTheDocument();
  });

  it("shows a closed-loop empty state when dashboard context is unavailable", () => {
    render(
      <ConsoleAiWorkbench
        currentUser={{ id: "user-ai", name: "AI Operator", role: "owner" }}
        dashboardHome={null}
        dashboardHomeError="AI 上下文暂不可用"
      />,
    );

    expect(screen.getByText("AI 上下文暂不可用")).toBeInTheDocument();
    expect(screen.getByText("暂无经营上下文")).toBeInTheDocument();
    expect(screen.getByTestId("ai-usage-dashboard")).toBeInTheDocument();
  });
});
