import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
