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
    const protocolFetch = createConversationProtocolFetch({
      content: "真实 DeepSeek 回复",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options) =>
        protocolFetch(url, options) || defaultFetchResponse(url),
      ),
    );
  });

  it("creates a durable conversation and sends only the new turn", async () => {
    const encoder = new TextEncoder();
    fetch.mockImplementation((url, options = {}) => {
      if (url === "/api/ai/conversations" && options.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              conversation: { id: "conversation-1", title: "新会话" },
            }),
        });
      }
      if (url === "/api/ai/conversations") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ conversations: [] }),
        });
      }
      if (url === "/api/ai/conversations/conversation-1/turns") {
        const sse = protocolSse([
          [
            "turn.started",
            {
              type: "turn.started",
              conversationId: "conversation-1",
              turnId: "turn-1",
              userMessageId: "message-user-1",
              assistantMessageId: "message-assistant-1",
            },
          ],
          [
            "context.ready",
            {
              type: "context.ready",
              conversationId: "conversation-1",
              turnId: "turn-1",
              snapshotVersion: 1,
            },
          ],
          [
            "response.delta",
            {
              type: "response.delta",
              conversationId: "conversation-1",
              turnId: "turn-1",
              messageId: "message-assistant-1",
              delta: "真实",
            },
          ],
          [
            "response.completed",
            {
              type: "response.completed",
              conversationId: "conversation-1",
              turnId: "turn-1",
              messageId: "message-assistant-1",
              content: "真实会话回复",
            },
          ],
        ]);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => "text/event-stream; charset=utf-8" },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse));
              controller.close();
            },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not found" }),
      });
    });

    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-1", name: "123", role: "owner" }}
      />,
    );
    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "解读当前风险" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("真实会话回复")).toBeInTheDocument();
    const turnCall = fetch.mock.calls.find(
      ([url]) => url === "/api/ai/conversations/conversation-1/turns",
    );
    const payload = JSON.parse(turnCall[1].body);
    expect(payload).toMatchObject({
      content: "解读当前风险",
      mode: "fast",
      attachments: [],
    });
    expect(payload.clientRequestId).toBeTruthy();
    expect(payload).not.toHaveProperty("messages");
    expect(fetch).not.toHaveBeenCalledWith("/api/ai/chat", expect.anything());
    expect(Object.values(localStorage).join(" ")).toContain("conversation-1");
  });

  it("fails closed when the conversation protocol is unavailable", async () => {
    fetch.mockImplementation((url, options = {}) => {
      if (url === "/api/ai/conversations") {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: "星耀 AI 会话协议不可用" }),
        });
      }
      return defaultFetchResponse(url, options);
    });

    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-1", name: "123", role: "owner" }}
      />,
    );
    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "分析风险" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("⚠ 星耀 AI 会话协议不可用")).toBeInTheDocument();
    expect(screen.queryByText("分析风险")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/api/ai/chat", expect.anything());
  });

  it("clears a stale stored conversation before creating a fresh one", async () => {
    localStorage.setItem(
      "jingying-cabin.dashboard.ai.conversation.v1.user-stale",
      "conversation-stale",
    );
    const protocolFetch = createConversationProtocolFetch({
      content: "fresh conversation reply",
      conversationId: "conversation-fresh",
    });
    fetch.mockImplementation((url, options) => {
      if (url === "/api/ai/conversations/conversation-stale") {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "Conversation not found" }),
        });
      }
      return protocolFetch(url, options) || defaultFetchResponse(url);
    });

    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-stale", name: "123", role: "owner" }}
      />,
    );
    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "新问题" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("fresh conversation reply")).toBeInTheDocument();
    expect(
      fetch.mock.calls.some(
        ([url]) => url === "/api/ai/conversations/conversation-fresh/turns",
      ),
    ).toBe(true);
  });

  it("rejects malformed terminal SSE envelopes", async () => {
    const encoder = new TextEncoder();
    const protocolFetch = createConversationProtocolFetch({
      content: "unused",
      conversationId: "conversation-malformed",
    });
    fetch.mockImplementation((url, options) => {
      if (url === "/api/ai/conversations/conversation-malformed/turns") {
        return Promise.resolve(
          protocolStreamResponse(encoder, [
            [
              "turn.started",
              {
                type: "turn.started",
                conversationId: "conversation-malformed",
                turnId: "turn-malformed",
                userMessageId: "message-user-malformed",
                assistantMessageId: "message-assistant-malformed",
              },
            ],
            [
              "response.completed",
              {
                type: "response.completed",
                conversationId: "conversation-malformed",
                turnId: "turn-malformed",
                messageId: "message-assistant-malformed",
                content: ".",
              },
            ],
          ]),
        );
      }
      return protocolFetch(url, options) || defaultFetchResponse(url);
    });

    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-malformed", name: "123", role: "owner" }}
      />,
    );
    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "检查协议" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText(/AI 会话连接提前结束/)).toBeInTheDocument();
    expect(screen.getByText("检查协议")).toBeInTheDocument();
    expect(screen.queryByText(".")).not.toBeInTheDocument();
  });

  it("retries a failed turn without sending a new user message", async () => {
    const encoder = new TextEncoder();
    fetch.mockImplementation((url, options = {}) => {
      if (url === "/api/ai/conversations" && options.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({ conversation: { id: "conversation-1" } }),
        });
      }
      if (url === "/api/ai/conversations") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ conversations: [] }),
        });
      }
      if (url === "/api/ai/conversations/conversation-1/turns") {
        return Promise.resolve(
          protocolStreamResponse(encoder, [
            [
              "turn.started",
              {
                type: "turn.started",
                conversationId: "conversation-1",
                turnId: "turn-1",
                userMessageId: "message-user-1",
                assistantMessageId: "message-assistant-1",
              },
            ],
            [
              "response.failed",
              {
                type: "response.failed",
                conversationId: "conversation-1",
                turnId: "turn-1",
                code: "provider_failed",
                retryable: true,
                message: "provider timeout",
              },
            ],
          ]),
        );
      }
      if (url === "/api/ai/turns/turn-1/retry") {
        return Promise.resolve(
          protocolStreamResponse(encoder, [
            [
              "turn.started",
              {
                type: "turn.started",
                conversationId: "conversation-1",
                turnId: "turn-2",
                userMessageId: "message-user-1",
                assistantMessageId: "message-assistant-2",
              },
            ],
            [
              "response.delta",
              {
                type: "response.delta",
                conversationId: "conversation-1",
                turnId: "turn-2",
                messageId: "message-assistant-2",
                delta: "恢复后的完整答复",
              },
            ],
            [
              "response.completed",
              {
                type: "response.completed",
                conversationId: "conversation-1",
                turnId: "turn-2",
                messageId: "message-assistant-2",
                content: "恢复后的完整答复",
              },
            ],
          ]),
        );
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not found" }),
      });
    });

    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-1", name: "123", role: "owner" }}
      />,
    );
    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "分析风险" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "重试" }));

    expect(await screen.findByText("恢复后的完整答复")).toBeInTheDocument();
    const retryCall = fetch.mock.calls.find(
      ([url]) => url === "/api/ai/turns/turn-1/retry",
    );
    const retryPayload = JSON.parse(retryCall[1].body);
    expect(Object.keys(retryPayload)).toEqual(["clientRequestId"]);
    expect(screen.getAllByText("分析风险")).toHaveLength(1);
    expect(screen.queryByText("重试", { selector: "div" })).not.toBeInTheDocument();
  });

  it("marks the replacement assistant message failed when a retry stream disconnects", async () => {
    const encoder = new TextEncoder();
    fetch.mockImplementation((url, options = {}) => {
      if (url === "/api/ai/conversations" && options.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ conversation: { id: "conversation-1" } }),
        });
      }
      if (url === "/api/ai/conversations") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ conversations: [] }),
        });
      }
      if (url === "/api/ai/conversations/conversation-1/turns") {
        return Promise.resolve(
          protocolStreamResponse(encoder, [
            [
              "turn.started",
              {
                type: "turn.started",
                conversationId: "conversation-1",
                turnId: "turn-1",
                userMessageId: "message-user-1",
                assistantMessageId: "message-assistant-1",
              },
            ],
            [
              "response.failed",
              {
                type: "response.failed",
                conversationId: "conversation-1",
                turnId: "turn-1",
                code: "provider_failed",
                retryable: true,
                message: "provider timeout",
              },
            ],
          ]),
        );
      }
      if (url === "/api/ai/turns/turn-1/retry") {
        return Promise.resolve(
          interruptedProtocolStreamResponse(
            encoder,
            [
              [
                "turn.started",
                {
                  type: "turn.started",
                  conversationId: "conversation-1",
                  turnId: "turn-2",
                  userMessageId: "message-user-1",
                  assistantMessageId: "message-assistant-2",
                },
              ],
              [
                "response.delta",
                {
                  type: "response.delta",
                  conversationId: "conversation-1",
                  turnId: "turn-2",
                  messageId: "message-assistant-2",
                  delta: "部分回复",
                },
              ],
            ],
            "socket closed",
          ),
        );
      }
      return defaultFetchResponse(url);
    });

    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-1", name: "123", role: "owner" }}
      />,
    );
    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "分析风险" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));

    expect(await screen.findByText(/socket closed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("restores the latest owner conversation and its retryable turn", async () => {
    fetch.mockImplementation((url) => {
      if (url === "/api/ai/conversations") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              conversations: [{ id: "conversation-remote", title: "风险处置" }],
            }),
        });
      }
      if (url === "/api/ai/conversations/conversation-remote") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              conversation: { id: "conversation-remote", title: "风险处置" },
              messages: [
                {
                  id: "message-user-remote",
                  role: "user",
                  status: "completed",
                  content: "远端会话问题",
                },
                {
                  id: "message-assistant-remote",
                  role: "assistant",
                  status: "failed",
                  content: "",
                },
              ],
              turns: [
                {
                  id: "turn-remote",
                  assistantMessageId: "message-assistant-remote",
                  status: "failed",
                  retryable: true,
                  errorSummary: "上游暂时不可用",
                },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not found" }),
      });
    });

    render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ id: "user-remote", name: "123", role: "owner" }}
      />,
    );

    expect(await screen.findByText("远端会话问题")).toBeInTheDocument();
    expect(screen.getByText("⚠ 上游暂时不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("consumes SSE streaming chat responses chunk by chunk into one bubble", async () => {
    const protocolFetch = createConversationProtocolFetch({
      content: "流式回复完成",
      chunks: ["流式", "回复"],
    });
    fetch.mockImplementation((url, options) =>
      protocolFetch(url, options) || defaultFetchResponse(url),
    );

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
    fireEvent.change(input, { target: { value: "流式测试" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // done 事件用最终文本替换流式过程中的同一个气泡，而不是追加新气泡。
    expect(await screen.findByText("流式回复完成")).toBeInTheDocument();
    expect(screen.queryByText("流式回复")).not.toBeInTheDocument();
    const turnCall = fetch.mock.calls.find(([url]) => url.endsWith("/turns"));
    expect(turnCall[1].headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(turnCall[1].body)).not.toHaveProperty("messages");
  });

  it("sends free-form messages through the durable conversation protocol", async () => {
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
      expect(fetch.mock.calls.some(([url]) => url.endsWith("/turns"))).toBe(true),
    );
    const turnCall = fetch.mock.calls.find(([url]) => url.endsWith("/turns"));
    const payload = JSON.parse(turnCall[1].body);
    expect(payload.content).toBe("你好");
    expect(payload).not.toHaveProperty("messages");
    expect(fetch).not.toHaveBeenCalledWith("/api/ai/chat", expect.anything());
    expect(await screen.findByText("真实 DeepSeek 回复")).toBeInTheDocument();
  });

  it("sends deep thinking mode and up to five attachments to the chat API", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "深度思考" }));
    const fileInput = screen.getByTestId("ai-attachment-input");
    const files = Array.from(
      { length: 5 },
      (_, index) =>
        new File([`attachment ${index + 1}`], `file-${index + 1}.txt`, {
          type: "text/plain",
        }),
    );
    fireEvent.change(fileInput, { target: { files } });

    expect(await screen.findByText("file-5.txt")).toBeInTheDocument();

    const input = container.querySelector("input");
    fireEvent.change(input, { target: { value: "Analyze attachments" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => url.endsWith("/turns"))).toBe(true),
    );
    const turnCall = fetch.mock.calls.find(([url]) => url.endsWith("/turns"));
    const payload = JSON.parse(turnCall[1].body);
    expect(payload.mode).toBe("deep");
    expect(payload.attachments).toHaveLength(5);
    expect(payload.attachments[0]).toMatchObject({
      name: "file-1.txt",
      mimeType: "text/plain",
      text: "attachment 1",
    });
    expect(payload.attachments[0].data).toContain("data:text/plain;base64");
  });

  it("keeps the assistant attachment list capped at five files", async () => {
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

    const fileInput = screen.getByTestId("ai-attachment-input");
    const fiveFiles = Array.from(
      { length: 5 },
      (_, index) =>
        new File([`attachment ${index + 1}`], `file-${index + 1}.txt`, {
          type: "text/plain",
        }),
    );
    fireEvent.change(fileInput, { target: { files: fiveFiles } });
    expect(await screen.findByText("file-5.txt")).toBeInTheDocument();

    fireEvent.change(fileInput, {
      target: {
        files: [new File(["extra"], "file-6.txt", { type: "text/plain" })],
      },
    });

    expect(await screen.findByText("最多支持 5 个附件")).toBeInTheDocument();
    expect(screen.queryByText("file-6.txt")).not.toBeInTheDocument();
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
      expect(fetch.mock.calls.some(([url]) => url.endsWith("/turns"))).toBe(true),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/ai/project-reviews",
      expect.anything(),
    );
    const turnCall = fetch.mock.calls.find(([url]) => url.endsWith("/turns"));
    expect(JSON.parse(turnCall[1].body).content).toBe(
      "帮我生成本月经营复盘报告，并结合知识库沉淀可复用经验",
    );
  });

  it("sends only the project id when the risk quick action calls project-reviews", async () => {
    fetch.mockImplementation((url) => {
      if (url === "/api/ai/project-reviews") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              agentOutput: {
                summary: "项目经营诊断已生成。",
                recommendations: [{ text: "优先复核低毛利项目" }],
                caveats: ["缺少最近一期结算数据，结论按现有数据给出。"],
              },
              dataGaps: ["缺少最近一期结算数据"],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ matches: { recommendations: [] } }),
      });
    });

    render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[
          {
            id: "3f5a1f9c-8f61-4f7a-9a44-2b6d8f0c1e57",
            name: "示例项目",
            status: "active",
            metrics: {},
          },
        ]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    fireEvent.click(screen.getByText("解读风险事项"));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/ai/project-reviews",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const reviewCall = fetch.mock.calls.find(
      ([url]) => url === "/api/ai/project-reviews",
    );
    expect(JSON.parse(reviewCall[1].body)).toEqual({
      projectId: "3f5a1f9c-8f61-4f7a-9a44-2b6d8f0c1e57",
    });
    expect(
      await screen.findByText(/项目经营诊断已生成。/),
    ).toBeInTheDocument();
  });

  it("hints instead of calling project-reviews when no project is loaded", async () => {
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

    fireEvent.click(screen.getByText("解读风险事项"));

    expect(
      await screen.findByText(
        "当前范围内暂无可诊断的项目，请先创建项目或调整周期后再试。",
      ),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/ai/project-reviews",
      expect.anything(),
    );
  });

  it("routes the business question quick action through the controlled copilot API", async () => {
    fetch.mockImplementation((url) => {
      if (url === "/api/ai/business-copilot") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              result: {
                output: {
                  question: "这个月经营健康吗",
                  intent: "executive_health",
                  answer: "经营健康判断已基于当前角色看板生成。",
                  facts: [
                    {
                      label: "毛利率",
                      value: 30,
                      unit: "%",
                      sourceTool: "role_home_dashboard",
                      sourceId: "kpi:grossMarginRate",
                    },
                  ],
                  recommendations: [
                    {
                      proposal: "先复核高风险项目和毛利拖累项。",
                      requiresHumanApproval: true,
                    },
                  ],
                  caveats: ["数据范围为当前账号授权组织和角色可见范围。"],
                  generatedAt: "2026-06-18T04:00:00.000Z",
                  sourceSummary: {
                    sourceTool: "role_home_dashboard",
                    scopeLabel: "全组织",
                    generatedAt: "2026-06-18T04:00:00.000Z",
                    readableAreas: ["kpis", "queue", "risks", "drilldowns"],
                  },
                  confidence: {
                    level: "medium",
                    label: "中等置信度",
                    reason: "回答引用了当前角色看板事实。",
                  },
                  requiresHumanConfirmation: true,
                },
              },
              dashboardProfile: { role: "owner", scopeLabel: "全组织" },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ matches: { recommendations: [] } }),
      });
    });

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

    fireEvent.click(screen.getByText("问经营数据"));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/ai/business-copilot",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const copilotCall = fetch.mock.calls.find(
      ([url]) => url === "/api/ai/business-copilot",
    );
    expect(JSON.parse(copilotCall[1].body)).toEqual({
      question: "这个月经营健康吗",
    });
    expect(
      await screen.findByText("经营健康判断已基于当前角色看板生成。"),
    ).toBeInTheDocument();
    expect(screen.getByText("毛利率：30%")).toBeInTheDocument();
    expect(screen.getByText("先复核高风险项目和毛利拖累项。")).toBeInTheDocument();
    expect(screen.getByText("需人工确认")).toBeInTheDocument();
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

  it("syncs the operating project card with project rollup metrics", () => {
    const { container } = render(
      <OverviewBoard
        dashboard={dashboard}
        projects={[
          {
            id: "project-active",
            name: "Active project",
            status: "active",
            start: "2026-06-16",
            end: "2026-06-16",
            metrics: { reportedPending: 2, anomalies: 4 },
          },
          {
            id: "project-recruiting",
            name: "Recruiting project",
            status: "recruiting",
            start: "2026-06-16",
            end: "2026-06-16",
            metrics: { reportedPending: 5, anomalies: 5 },
          },
          {
            id: "project-settling",
            name: "Settling project",
            status: "settling",
            start: "2026-06-16",
            end: "2026-06-16",
            metrics: { reportedPending: 0, anomalies: 0 },
          },
          {
            id: "project-finished",
            name: "Finished project",
            status: "done",
            start: "2026-06-16",
            end: "2026-06-16",
            metrics: { reportedPending: 0, anomalies: 0 },
          },
        ]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const projectCard = container.querySelector(".ob-project-card");
    expect(projectCard).toBeTruthy();
    expect((projectCard.textContent || "").match(/\d+/g)).toEqual([
      "4",
      "3",
      "7",
      "9",
    ]);
  });

  it("renders the admission funnel as a model with metrics, segments, and decisions", () => {
    render(
      <OverviewBoard
        dashboard={{
          ...dashboard,
          panels: {
            admissionFunnel: {
              title: "Admission funnel",
              stages: [
                { key: "signup", label: "Signup", value: 278 },
                { key: "review", label: "Review", value: 276 },
                { key: "approved", label: "Approved", value: 265 },
              ],
            },
          },
        }}
        projects={[]}
        tasks={[]}
        reports={[]}
        batches={[]}
        currentUser={{ name: "123", role: "owner" }}
      />,
    );

    const model = screen.getByTestId("admission-funnel-model");
    expect(screen.getAllByTestId("admission-funnel-metric")).toHaveLength(3);
    expect(screen.getAllByTestId("admission-funnel-segment")).toHaveLength(3);
    expect(screen.getAllByTestId("admission-funnel-decision")).toHaveLength(3);
    expect(within(model).getAllByText("Signup").length).toBeGreaterThan(0);
    expect(within(model).getByText("278")).toBeInTheDocument();
    expect(within(model).getByText("业务决策")).toBeInTheDocument();
  });

  it("keeps the admission funnel usable when the main board is narrow", () => {
    const { container } = render(
      <OverviewBoard
        dashboard={{
          ...dashboard,
          panels: {
            admissionFunnel: {
              title: "准入漏斗 · 录屏到入项",
              stages: [
                { key: "signup", label: "报名 / 候选", value: 277 },
                { key: "review", label: "录屏待审", value: 275 },
                { key: "approved", label: "最终入项", value: 265 },
              ],
            },
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

    expect(container.querySelector(".ob-admission-funnel-grid")).toBeTruthy();
    expect(styleText).toContain(
      "grid-template-columns:minmax(150px,.78fr) minmax(180px,1fr) minmax(180px,1fr)",
    );
    expect(styleText).toContain("@container (max-width:760px)");
    expect(styleText).toContain(
      ".ob-admission-funnel-decision{grid-column:1 / -1}",
    );
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

  it("keeps overview KPI labels intact when the main board is narrow", () => {
    const { container } = render(
      <OverviewBoard
        dashboard={{
          ...dashboard,
          actionGroups: [
            {
              key: "projects",
              title: "项目待办",
              items: [
                { key: "active", label: "进行中", value: 19, tone: "blue" },
                { key: "recruiting", label: "招募中", value: 2 },
              ],
            },
            {
              key: "review",
              title: "复盘待办",
              items: [
                { key: "low", label: "低毛利", value: 24, tone: "amber" },
                { key: "negative", label: "负毛利", value: 0, tone: "amber" },
              ],
            },
            {
              key: "settle",
              title: "结算待办",
              items: [
                { key: "draft", label: "待生成", value: 0 },
                { key: "confirm", label: "待确认", value: 5, tone: "amber" },
              ],
            },
            {
              key: "audit",
              title: "审计待办",
              items: [
                { key: "risk", label: "高风险", value: 7, tone: "amber" },
                { key: "reopen", label: "重开", value: 0 },
              ],
            },
          ],
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
    const labels = screen.getAllByTestId("overview-kpi-metric-label");

    expect(container.querySelector(".ob-kpi-grid")).toBeTruthy();
    expect(styleText).toContain("@container (max-width:860px)");
    expect(styleText).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(labels).toHaveLength(8);
    for (const label of labels) {
      expect(label).toHaveStyle({
        whiteSpace: "nowrap",
        wordBreak: "keep-all",
      });
    }
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

    mockConversationProtocol({ content: markdownTable });

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

    mockConversationProtocol({ content: markdownDocument });

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

  it("uses a wide fluid assistant panel on desktop", () => {
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

    expect(styleText).toContain("--ob-ai-width:clamp(360px,21vw,440px)");
    expect(styleText).toContain("width:var(--ob-ai-width)");
  });

  it("keeps the desktop board composition until the window is genuinely compact", () => {
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

    expect(styleText).toContain("--ob-ai-width:clamp(360px,21vw,440px)");
    expect(styleText).toContain("--ob-personal-width:clamp(280px,15vw,300px)");
    expect(styleText).toContain(
      "grid-template-columns:minmax(0,1fr) var(--ob-personal-width)",
    );
    expect(styleText).toContain("@media(max-width:1180px)");
    expect(styleText).not.toContain("@media(max-width:1670px)");
    expect(styleText).not.toContain("@media(max-width:1390px)");
  });

  it("renders and persists project health cards returned by the AI chat API", async () => {
    const grounding = {
      projectHealth: {
        topProjects: [
          {
            projectId: "p-low-margin",
            projectName: "Nova Launch",
            priority: "high",
            score: 125,
            reasons: [
              "Negative gross profit in project ranking",
              "Matched current risk queue",
            ],
            evidence: [
              {
                sourceTool: "role_home_dashboard",
                sourceId: "panel:projectRanking:rank:p-low-margin",
              },
            ],
            target: { route: "project", id: "p-low-margin" },
          },
        ],
      },
      suggestedActions: [
        {
          actionId: "p-low-margin:margin-review",
          projectId: "p-low-margin",
          projectName: "Nova Launch",
          priority: "high",
          title: "Review margin and cost assumptions",
          rationale: "The project has margin signals that need a human review.",
          evidence: [
            {
              sourceTool: "role_home_dashboard",
              sourceId: "panel:projectRanking:rank:p-low-margin",
            },
          ],
          target: { route: "project", id: "p-low-margin" },
          requiresHumanApproval: true,
        },
      ],
    };
    mockConversationProtocol({
      content: "AI summary",
      meta: { grounding },
    });
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
    fireEvent.change(input, { target: { value: "What should we fix first?" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("AI summary")).toBeInTheDocument();
    expect(screen.getByTestId("ai-project-health-card")).toBeInTheDocument();
    expect(screen.getAllByText("Nova Launch").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("high").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Negative gross profit in project ranking"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ai-suggested-action-card")).toBeInTheDocument();
    expect(
      screen.getByText("Review margin and cost assumptions"),
    ).toBeInTheDocument();
    expect(screen.getByText("Human approval required")).toBeInTheDocument();

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

    expect(await screen.findByText("AI summary")).toBeInTheDocument();
    expect(screen.getByTestId("ai-project-health-card")).toBeInTheDocument();
    expect(screen.getByTestId("ai-suggested-action-card")).toBeInTheDocument();
    expect(screen.getAllByText("Nova Launch").length).toBeGreaterThanOrEqual(1);
  });

  it("creates a pending todo draft from an AI suggested action", async () => {
    const protocolFetch = createConversationProtocolFetch({
      content: "AI summary",
      meta: {
        grounding: {
          suggestedActions: [
            {
              actionId: "p-low-margin:margin-review",
              projectId: "p-low-margin",
              projectName: "Nova Launch",
              priority: "high",
              title: "Review margin and cost assumptions",
              rationale:
                "The project has margin signals that need a human review.",
              evidence: [
                {
                  sourceTool: "role_home_dashboard",
                  sourceId: "panel:projectRanking:rank:p-low-margin",
                },
              ],
              target: { route: "project", id: "p-low-margin" },
              requiresHumanApproval: true,
            },
          ],
        },
      },
    });
    fetch.mockImplementation((url, options) => {
      if (url === "/api/ai/drafts?status=pending") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ drafts: [] }),
        });
      }
      if (url === "/api/ai/drafts/suggested-action") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              todo: {
                key: "ai-draft:draft-action-1",
                text: "Review margin and cost assumptions",
                count: "high",
                tone: "danger",
                route: "project",
                targetId: "p-low-margin",
                draftId: "draft-action-1",
              },
            }),
        });
      }
      return protocolFetch(url, options) || defaultFetchResponse(url);
    });

    const { container } = render(
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
    fireEvent.change(input, { target: { value: "What should we fix first?" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "创建待办草稿" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/ai/drafts/suggested-action",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("待办草稿已创建")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText("high").length).toBeGreaterThanOrEqual(2),
    );
  });

  it("hydrates pending AI todo drafts into the todo panel", async () => {
    fetch.mockImplementation((url) => {
      if (url === "/api/ai/drafts?status=pending") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              drafts: [
                {
                  id: "draft-action-1",
                  draftType: "suggested_action_todo",
                  status: "pending",
                  payload: {
                    title: "Review margin and cost assumptions",
                    priority: "high",
                    route: "project",
                    targetId: "p-low-margin",
                  },
                },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ matches: { recommendations: [] } }),
      });
    });

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

    expect(
      await screen.findByText("Review margin and cost assumptions"),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/ai/drafts?status=pending", {
      cache: "no-store",
    });
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

    expect(await screen.findByText("默认分析本月")).toBeInTheDocument();
    expect(await screen.findByText("真实 DeepSeek 回复")).toBeInTheDocument();
  });
});

function protocolSse(events) {
  return events
    .map(
      ([event, data]) =>
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

function protocolStreamResponse(encoder, events) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream; charset=utf-8" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(protocolSse(events)));
        controller.close();
      },
    }),
  };
}

function interruptedProtocolStreamResponse(encoder, events, message) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream; charset=utf-8" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(protocolSse(events)));
        setTimeout(() => controller.error(new Error(message)), 0);
      },
    }),
  };
}

function createConversationProtocolFetch({
  content,
  chunks = [],
  meta,
  conversationId = "conversation-test",
}) {
  const encoder = new TextEncoder();
  let created = false;
  let turnSequence = 0;
  const messages = [];
  const turns = [];

  return (url, options = {}) => {
    if (url === "/api/ai/conversations" && options.method === "POST") {
      created = true;
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({ conversation: { id: conversationId, title: "新会话" } }),
      });
    }
    if (url === "/api/ai/conversations") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            conversations: created ? [{ id: conversationId, title: "新会话" }] : [],
          }),
      });
    }
    if (url === `/api/ai/conversations/${conversationId}`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            conversation: { id: conversationId, title: "新会话" },
            messages,
            turns,
          }),
      });
    }
    if (url === `/api/ai/conversations/${conversationId}/turns`) {
      created = true;
      turnSequence += 1;
      const payload = JSON.parse(options.body || "{}");
      const turnId = `turn-${turnSequence}`;
      const userMessageId = `message-user-${turnSequence}`;
      const assistantMessageId = `message-assistant-${turnSequence}`;
      messages.push({
        id: userMessageId,
        role: "user",
        status: "completed",
        content: payload.content,
      });
      messages.push({
        id: assistantMessageId,
        role: "assistant",
        status: "completed",
        content,
        ...(meta ? { metadata: meta } : {}),
      });
      turns.push({
        id: turnId,
        assistantMessageId,
        status: "completed",
        retryable: false,
      });
      return Promise.resolve(
        protocolStreamResponse(encoder, [
          [
            "turn.started",
            {
              type: "turn.started",
              conversationId,
              turnId,
              userMessageId,
              assistantMessageId,
            },
          ],
          ...chunks.map((delta) => [
            "response.delta",
            {
              type: "response.delta",
              conversationId,
              turnId,
              messageId: assistantMessageId,
              delta,
            },
          ]),
          [
            "response.completed",
            {
              type: "response.completed",
              conversationId,
              turnId,
              messageId: assistantMessageId,
              content,
              ...(meta ? { meta } : {}),
            },
          ],
        ]),
      );
    }
    return null;
  };
}

function mockConversationProtocol(options) {
  const protocolFetch = createConversationProtocolFetch(options);
  fetch.mockImplementation((url, requestOptions) =>
    protocolFetch(url, requestOptions) || defaultFetchResponse(url),
  );
}

function defaultFetchResponse(url) {
  if (url === "/api/ai/drafts?status=pending") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ drafts: [] }),
    });
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ matches: { recommendations: [] } }),
  });
}
