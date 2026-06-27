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
});
