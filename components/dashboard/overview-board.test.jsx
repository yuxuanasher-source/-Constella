import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OverviewBoard } from "./overview-board";

const dashboard = {
  profile: {
    title: "经营总览看板",
    role: "owner",
    scopeLabel: "全组织",
    realtime: true,
    updatedAt: new Date().toISOString(),
  },
  riskSummary: { count: 0 },
  panels: [],
  kpis: [],
  queue: [],
  risks: [],
};

describe("OverviewBoard AI panel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (url === "/api/ai/chat") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                message: { role: "assistant", content: "真实 DeepSeek 回复" },
                providerName: "deepseek",
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ matches: { recommendations: [] } }),
        });
      }),
    );
  });

  it("sends free-form messages to the chat API", async () => {
    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const input = container.querySelector("input");
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/ai/chat", expect.anything()),
    );
    const chatCall = fetch.mock.calls.find(([url]) => url === "/api/ai/chat");
    expect(JSON.parse(chatCall[1].body).messages.at(-1)).toEqual({
      role: "user",
      content: "你好",
    });
    expect(await screen.findByText("真实 DeepSeek 回复")).toBeInTheDocument();
  });

  it("routes the recap quick action through the knowledge-grounded chat API", async () => {
    render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    fireEvent.click(screen.getByText("生成复盘报告"));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/ai/chat", expect.anything()),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/ai/project-reviews",
      expect.anything(),
    );
    const chatCall = fetch.mock.calls.find(([url]) => url === "/api/ai/chat");
    expect(JSON.parse(chatCall[1].body).messages.at(-1)).toEqual({
      role: "user",
      content: "帮我生成本月经营复盘报告，并结合知识库沉淀可复用经验",
    });
  });

  it("renders dashboard-provided action widgets instead of empty client fallbacks", () => {
    render(
      <OverviewBoard
        dashboard={{
          ...dashboard,
          actionGroups: [
            {
              key: "projects",
              title: "项目待办",
              items: [
                {
                  key: "active",
                  label: "进行中",
                  value: 19,
                  tone: "blue",
                  target: { route: "projects" },
                },
                {
                  key: "recruiting",
                  label: "招募中",
                  value: 6,
                  tone: "neutral",
                  target: { route: "projects" },
                },
              ],
            },
            {
              key: "audit",
              title: "审计待办",
              items: [
                {
                  key: "risk",
                  label: "高风险",
                  value: 3,
                  tone: "red",
                  target: { route: "audit" },
                },
                {
                  key: "reopened",
                  label: "重开",
                  value: 2,
                  tone: "amber",
                  target: { route: "settle" },
                },
              ],
            },
          ],
          personal: {
            summary: [
              { key: "active", label: "在营项目", value: 19, tone: "blue" },
              { key: "todo", label: "待办合计", value: 30, tone: "violet" },
              {
                key: "risk",
                label: "风险数",
                value: 3,
                tone: "amber",
                attention: true,
              },
              { key: "today", label: "今日场次", value: 8, tone: "green" },
            ],
            recommendations: [
              {
                key: "risk",
                icon: "险",
                text: "处理高风险通知",
                sub: "3 条待核验",
                tone: "warn",
                cta: "去处理",
                target: { route: "audit" },
              },
            ],
            todos: [
              {
                key: "risk",
                text: "核验高风险通知",
                count: 3,
                tone: "warn",
                target: { route: "audit" },
              },
            ],
          },
        }}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const projectCard = screen.getByText("项目待办").closest(".lift");
    expect(projectCard).toBeTruthy();
    expect(within(projectCard).getByText("19")).toBeInTheDocument();
    expect(within(projectCard).getByText("6")).toBeInTheDocument();

    const overview = screen.getByText("大盘总览").closest(".card");
    expect(within(overview).getByText("30")).toBeInTheDocument();
    expect(within(overview).getByText("8")).toBeInTheDocument();
    expect(screen.getByText("处理高风险通知")).toBeInTheDocument();
    expect(screen.getByText("核验高风险通知")).toBeInTheDocument();
    expect(
      screen.queryByText("暂无紧急待办，保持关注经营总览"),
    ).not.toBeInTheDocument();
  });

  it("renders live metric and overview summary series as dynamic mini charts", () => {
    render(
      <OverviewBoard
        dashboard={{
          ...dashboard,
          kpis: [
            {
              key: "vendorReceivable",
              label: "本月厂家应收",
              value: 2847500,
              unit: "元",
              series: [0, 1000000, 1900000, 2847500],
            },
            {
              key: "estimatedGross",
              label: "预计毛利",
              value: 684200,
              unit: "元",
              series: [0, 210000, 510000, 684200],
            },
            {
              key: "grossMarginRate",
              label: "预计毛利率",
              value: 24,
              unit: "%",
              series: [31, 27, 25, 24],
            },
            {
              key: "highRiskItems",
              label: "高风险事项",
              value: 4,
              unit: "项",
              tone: "red",
              series: [1, 2, 3, 4],
            },
          ],
          personal: {
            summary: [
              {
                key: "active",
                label: "在营项目",
                value: 19,
                tone: "blue",
                series: [3, 8, 12, 19],
              },
              {
                key: "todo",
                label: "待办合计",
                value: 47,
                tone: "violet",
                series: [12, 22, 35, 47],
              },
              {
                key: "risk",
                label: "风险数",
                value: 5,
                tone: "amber",
                attention: true,
                series: [1, 2, 4, 5],
              },
              {
                key: "today",
                label: "今日场次",
                value: 7,
                tone: "green",
                series: [0, 2, 4, 7],
              },
            ],
            recommendations: [],
            todos: [],
          },
        }}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    expect(screen.getAllByTestId("live-kpi-sparkline")).toHaveLength(4);
    expect(screen.getAllByTestId("personal-summary-sparkline")).toHaveLength(4);
  });

  it("renders live KPI sparklines as balanced full-width chart canvases", () => {
    render(
      <OverviewBoard
        dashboard={{
          ...dashboard,
          kpis: [
            {
              key: "vendorReceivable",
              label: "Receivable",
              value: 130.68,
              unit: "w",
              series: [10, 30, 70, 130],
            },
            {
              key: "estimatedGross",
              label: "Gross",
              value: -1.9,
              unit: "w",
              series: [5, 1, -1, -1.9],
            },
          ],
          personal: {
            summary: [
              {
                key: "active",
                label: "Active",
                value: 19,
                tone: "blue",
                series: [95, 93, 88, 82],
              },
            ],
            recommendations: [],
            todos: [],
          },
        }}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const charts = screen.getAllByTestId("live-kpi-sparkline");
    expect(charts.length).toBeGreaterThan(0);
    for (const svg of charts) {
      expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
      expect(svg.style.maxWidth).toBe("");
      expect(Number(svg.getAttribute("height"))).toBeGreaterThanOrEqual(52);
      const [, , viewBoxWidth, viewBoxHeight] = svg
        .getAttribute("viewBox")
        .split(/\s+/)
        .map(Number);
      expect(viewBoxWidth).toBeGreaterThanOrEqual(220);
      expect(viewBoxHeight).toBeGreaterThanOrEqual(48);
      const polyline = svg.querySelector("polyline");
      const xs = polyline
        .getAttribute("points")
        .trim()
        .split(/\s+/)
        .map((point) => Number(point.split(",")[0]));
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
      expect(Math.max(...xs)).toBeLessThanOrEqual(viewBoxWidth - 10);
    }
  });

  it("applies command-center visual surfaces to the dashboard", () => {
    const { container } = render(
      <OverviewBoard
        dashboard={{
          ...dashboard,
          actionGroups: [
            {
              key: "projects",
              title: "Projects",
              items: [
                { key: "active", label: "Active", value: 19, tone: "blue" },
                { key: "recruiting", label: "Recruiting", value: 2 },
              ],
            },
            {
              key: "review",
              title: "Review",
              items: [
                { key: "low", label: "Low margin", value: 3, tone: "amber" },
                { key: "negative", label: "Negative", value: 10, tone: "red" },
              ],
            },
            {
              key: "settle",
              title: "Settlement",
              items: [
                { key: "draft", label: "Draft", value: 0 },
                { key: "confirm", label: "Confirm", value: 5, tone: "amber" },
              ],
            },
            {
              key: "audit",
              title: "Audit",
              items: [
                { key: "risk", label: "Risk", value: 8, tone: "red" },
                { key: "reopen", label: "Reopen", value: 0 },
              ],
            },
          ],
          kpis: [
            {
              key: "vendorReceivable",
              label: "Receivable",
              value: 130.68,
              unit: "w",
              series: [20, 60, 90, 130.68],
            },
            {
              key: "estimatedGross",
              label: "Gross",
              value: -1.9,
              unit: "w",
              series: [4, 2, 0, -1.9],
            },
            {
              key: "grossMarginRate",
              label: "Margin",
              value: -14668.5,
              unit: "%",
              series: [12, -50, -8000, -14668.5],
            },
            {
              key: "highRiskItems",
              label: "Risks",
              value: 52,
              unit: "items",
              tone: "red",
              series: [5, 22, 52],
            },
          ],
          personal: {
            summary: [
              { key: "active", label: "Active", value: 19, tone: "blue" },
              { key: "todo", label: "Todo", value: 47, tone: "violet" },
              { key: "risk", label: "Risks", value: 52, tone: "amber" },
              { key: "today", label: "Today", value: 7, tone: "green" },
            ],
            recommendations: [],
            todos: [],
          },
        }}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const styleText = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent || "")
      .join("\n");

    expect(styleText).toContain("--ob-command-bg");
    expect(styleText).toContain("--ob-panel-shadow");
    expect(styleText).toContain(".ob-kpi-card");
    expect(container.querySelector(".ob-command-surface")).toBeTruthy();
    expect(container.querySelector(".ob-segmented")).toBeTruthy();
    expect(container.querySelectorAll(".ob-kpi-card")).toHaveLength(4);
    expect(container.querySelector(".ob-live-card")).toBeTruthy();
    expect(container.querySelector(".ob-side-card")).toBeTruthy();
  });

  it("filters dashboard widgets when switching the period tabs", () => {
    render(
      <OverviewBoard
        dashboard={{
          ...dashboard,
          generatedAt: "2026-06-16T03:00:00.000Z",
        }}
        projects={[
          {
            id: "project-today",
            name: "今日项目",
            status: "active",
            start: "2026-06-16",
            end: "2026-06-16",
            metrics: {
              receivable: 100,
              gross: 40,
              margin: 40,
              reportedPending: 0,
              anomalies: 0,
            },
            streamers: { active: 1, candidate: 0, pendingReview: 0 },
            risk: "low",
          },
          {
            id: "project-month",
            name: "本月项目",
            status: "recruiting",
            start: "2026-06-10",
            end: "2026-06-10",
            metrics: {
              receivable: 300,
              gross: 30,
              margin: 10,
              reportedPending: 0,
              anomalies: 0,
            },
            streamers: { active: 0, candidate: 1, pendingReview: 0 },
            risk: "low",
          },
          {
            id: "project-old",
            name: "上月项目",
            status: "active",
            start: "2026-05-20",
            end: "2026-05-20",
            metrics: {
              receivable: 500,
              gross: -20,
              margin: -4,
              reportedPending: 0,
              anomalies: 0,
            },
            streamers: { active: 1, candidate: 0, pendingReview: 0 },
            risk: "high",
          },
        ]}
        tasks={[
          {
            id: "task-today",
            status: "live",
            plannedStartAt: "2026-06-16T02:00:00.000Z",
            plannedEndAt: "2026-06-16T03:00:00.000Z",
          },
          {
            id: "task-month",
            status: "pending_live",
            plannedStartAt: "2026-06-10T02:00:00.000Z",
            plannedEndAt: "2026-06-10T03:00:00.000Z",
          },
          {
            id: "task-old",
            status: "abnormal",
            anomaly: true,
            plannedStartAt: "2026-05-20T02:00:00.000Z",
            plannedEndAt: "2026-05-20T03:00:00.000Z",
          },
        ]}
        reports={[
          {
            id: "report-today",
            status: "pending_review",
            submittedAt: "2026-06-16T03:30:00.000Z",
          },
          {
            id: "report-month",
            status: "pending_review",
            submittedAt: "2026-06-11T03:30:00.000Z",
          },
          {
            id: "report-old",
            status: "pending_review",
            submittedAt: "2026-05-21T03:30:00.000Z",
          },
        ]}
        batches={[
          {
            id: "batch-today",
            status: "draft",
            periodStart: "2026-06-16",
            periodEnd: "2026-06-16",
            updatedAt: "2026-06-16T04:00:00.000Z",
          },
          {
            id: "batch-month",
            status: "generated",
            periodStart: "2026-06-01",
            periodEnd: "2026-06-30",
            updatedAt: "2026-06-16T04:00:00.000Z",
          },
          {
            id: "batch-old",
            status: "reopened",
            periodStart: "2026-05-01",
            periodEnd: "2026-05-31",
            updatedAt: "2026-05-21T04:00:00.000Z",
          },
        ]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    fireEvent.click(screen.getByText("今日"));

    const todayProjectCard = screen.getByText("项目待办").closest(".lift");
    expect(within(todayProjectCard).getByText("进行中")).toBeInTheDocument();
    expect(within(todayProjectCard).getByText("1")).toBeInTheDocument();
    expect(within(todayProjectCard).getByText("招募中")).toBeInTheDocument();
    expect(within(todayProjectCard).getByText("0")).toBeInTheDocument();

    const todayReceivable = screen.getByText("本月厂家应收").parentElement;
    expect(within(todayReceivable).getByText("100")).toBeInTheDocument();
    const todayGross = screen.getByText("预计毛利").parentElement;
    expect(within(todayGross).getByText("40")).toBeInTheDocument();

    const overview = screen.getByText("大盘总览").closest(".card");
    expect(within(overview).getByText("今日")).toBeInTheDocument();
    expect(within(overview).getByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("本月"));

    const monthReceivable = screen.getByText("本月厂家应收").parentElement;
    expect(within(monthReceivable).getByText("400")).toBeInTheDocument();
    const monthGross = screen.getByText("预计毛利").parentElement;
    expect(within(monthGross).getByText("70")).toBeInTheDocument();
    const monthProjectCard = screen.getByText("项目待办").closest(".lift");
    expect(within(monthProjectCard).getByText("进行中")).toBeInTheDocument();
    expect(within(monthProjectCard).getByText("招募中")).toBeInTheDocument();
    expect(within(monthProjectCard).getAllByText("1")).toHaveLength(2);
    expect(within(overview).getByText("本月")).toBeInTheDocument();
  });

  it("renders markdown tables as readable stacked cards", async () => {
    const markdownTable = [
      "以下是系统中可见的具体项目信息：",
      "",
      "| 项目名称 | 项目ID（部分） | 当前状态 | 毛利率 | 备注 |",
      "|---|---|---|---|---|",
      "| **测试3** | ...2b0048df | **招募中 (recruiting)** | 0.0% | 来源: dashboard.queue.project:2b0048df |",
      "| **新项目草稿** | ...2ba8b258 | **结算中 (settling)** | 100.0% | 来源: dashboard.panels.projectRanking |",
      "",
      "说明：仅显示系统可见数据。",
    ].join("\n");

    fetch.mockImplementation((url) => {
      if (url === "/api/ai/chat") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              message: { role: "assistant", content: markdownTable },
              providerName: "deepseek",
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ matches: { recommendations: [] } }),
      });
    });

    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "具体项目" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("测试3")).toBeInTheDocument();
    expect(screen.getByText("新项目草稿")).toBeInTheDocument();
    expect(screen.getAllByTestId("ai-markdown-table-row")).toHaveLength(2);
    expect(screen.getAllByText("项目ID（部分）")).toHaveLength(2);
    expect(screen.getByText("招募中 (recruiting)")).toBeInTheDocument();
    expect(screen.queryByText(/\| 项目名称 \|/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\|---/)).not.toBeInTheDocument();
  });

  it("renders markdown prose as a readable document", async () => {
    const markdownDocument = [
      "### 经营分析",
      "",
      "**结论**：本月可见项目整体健康。",
      "",
      "- 优先处理低毛利项目",
      "- 核对 dashboard.kpis.receivable 来源",
      "",
      "1. 先看风险项目",
      "2. 再安排复盘",
    ].join("\n");

    fetch.mockImplementation((url) => {
      if (url === "/api/ai/chat") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              message: { role: "assistant", content: markdownDocument },
              providerName: "deepseek",
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ matches: { recommendations: [] } }),
      });
    });

    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "默认分析本月" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(
      await screen.findByRole("heading", { name: "经营分析" }),
    ).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("结论");
    expect(screen.getByText("优先处理低毛利项目")).toBeInTheDocument();
    expect(
      screen.getByText("核对 dashboard.kpis.receivable 来源"),
    ).toBeInTheDocument();
    expect(screen.getByText("先看风险项目")).toBeInTheDocument();
    expect(screen.getByText("再安排复盘")).toBeInTheDocument();
    expect(screen.queryByText(/### 经营分析/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\*\*结论\*\*/)).not.toBeInTheDocument();
  });

  it("uses a wider fixed assistant panel on desktop", () => {
    render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const styleText = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent || "")
      .join("\n");

    expect(styleText).toContain("--ob-ai-width:440px");
    expect(styleText).toContain("width:var(--ob-ai-width)");
  });

  it("restores assistant conversation after the panel remounts", async () => {
    const { container, unmount } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-123", name: "123", role: "owner" }}
      />,
    );

    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "默认分析本月" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("真实 DeepSeek 回复")).toBeInTheDocument();

    unmount();
    render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-123", name: "123", role: "owner" }}
      />,
    );

    expect(screen.getByText("默认分析本月")).toBeInTheDocument();
    expect(screen.getByText("真实 DeepSeek 回复")).toBeInTheDocument();
  });
});
