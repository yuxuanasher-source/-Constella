import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.fn();
const getAuthContextMock = vi.fn();
const createConfiguredAiProvidersMock = vi.fn();
const resolveAiProviderRoutingMock = vi.fn();
const runAiGatewayMock = vi.fn();
const recordAiInvocationMock = vi.fn();
const loadRoleHomeDashboardMock = vi.fn();

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: getAuthContextMock,
}));

vi.mock("@/features/ai/provider-registry", () => ({
  createConfiguredAiProviders: createConfiguredAiProvidersMock,
  resolveAiProviderRouting: resolveAiProviderRoutingMock,
}));

vi.mock("@/features/ai/llm-gateway", () => ({
  runAiGateway: runAiGatewayMock,
}));

vi.mock("@/features/ai/invocation-ledger", () => ({
  recordAiInvocation: recordAiInvocationMock,
}));

vi.mock("@/features/dashboards/role-home-loader", () => ({
  loadRoleHomeDashboard: loadRoleHomeDashboardMock,
}));

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    vi.resetModules();
    createSupabaseServerClientMock.mockReset();
    getAuthContextMock.mockReset();
    createConfiguredAiProvidersMock.mockReset();
    resolveAiProviderRoutingMock.mockReset();
    runAiGatewayMock.mockReset();
    recordAiInvocationMock.mockReset();
    loadRoleHomeDashboardMock.mockReset();

    createSupabaseServerClientMock.mockResolvedValue({ from: vi.fn() });
    getAuthContextMock.mockResolvedValue({
      userId: "user-1",
      email: "ops@example.com",
      name: "123",
      organizationId: "org-1",
      organizationName: "Org",
      role: "ops_manager",
    });
    createConfiguredAiProvidersMock.mockReturnValue([
      { name: "deepseek", capabilities: ["text"] },
    ]);
    resolveAiProviderRoutingMock.mockReturnValue({
      primaryProvider: "deepseek",
      shadowProvider: undefined,
    });
    loadRoleHomeDashboardMock.mockResolvedValue({
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
      queue: [],
      risks: [
        {
          key: "highRisk",
          title: "高风险项目",
          subtitle: "1 个项目需要复核",
          tone: "red",
          target: { route: "projects" },
        },
      ],
      drilldowns: [],
      generatedAt: "2026-06-28T01:20:00.000Z",
    });
    runAiGatewayMock.mockResolvedValue({
      status: "succeeded",
      providerName: "deepseek",
      text: "本月可见经营数据：进行中项目 3 个，本月厂家应收 240 元。",
      fallbackUsed: false,
      usage: { promptTokens: 12, completionTokens: 9, totalTokens: 21 },
      latencyMs: 123,
      costCents: 0.01,
    });
    recordAiInvocationMock.mockResolvedValue("invocation-1");
  });

  it("forwards sanitized chat history plus grounded dashboard facts to the configured model", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [
            { role: "assistant", content: "上一轮回复" },
            { role: "user", content: "默认分析本月" },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: {
        role: "assistant",
        content: "本月可见经营数据：进行中项目 3 个，本月厂家应收 240 元。",
      },
      providerName: "deepseek",
      status: "succeeded",
      grounding: {
        generatedAt: "2026-06-28T01:20:00.000Z",
        facts: expect.arrayContaining([
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
        ]),
      },
    });
    expect(loadRoleHomeDashboardMock).toHaveBeenCalledWith({
      supabase: expect.anything(),
      auth: expect.objectContaining({ organizationId: "org-1" }),
    });
    expect(runAiGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryProvider: "deepseek",
        request: expect.objectContaining({
          kind: "text",
          promptKey: "dashboard.ai.chat",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({
              role: "system",
              content: expect.stringContaining("真实业务事实包"),
            }),
            { role: "assistant", content: "上一轮回复" },
            { role: "user", content: "默认分析本月" },
          ]),
        }),
      }),
    );
    const messages = runAiGatewayMock.mock.calls[0][0].request.messages;
    const groundedText = messages
      .map((message: { content: string }) => message.content)
      .join("\n");
    expect(groundedText).toContain("本月厂家应收");
    expect(groundedText).toContain("240 元");
    expect(groundedText).toContain("dashboard.kpis.receivable");
    expect(groundedText).toContain("不得编造 facts 中不存在的数字");
    expect(recordAiInvocationMock).toHaveBeenCalledWith({
      client: expect.anything(),
      actor: expect.objectContaining({ userId: "user-1", role: "ops_manager" }),
      input: expect.objectContaining({
        scene: "dashboard_ai_chat",
        providerName: "deepseek",
        status: "succeeded",
        promptKey: "dashboard.ai.chat",
        metadata: expect.objectContaining({
          groundingFactCount: expect.any(Number),
        }),
      }),
    });
  });

  it("stops instead of asking the model when real dashboard data cannot be loaded", async () => {
    loadRoleHomeDashboardMock.mockRejectedValue(
      new Error("dashboard unavailable"),
    );
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "分析本月" }],
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("无法读取真实业务数据"),
    });
    expect(runAiGatewayMock).not.toHaveBeenCalled();
  });

  it("rejects non-MCN staff", async () => {
    getAuthContextMock.mockResolvedValue({
      userId: "streamer-1",
      name: "主播",
      organizationId: "org-1",
      role: "streamer",
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
      }),
    );

    expect(response.status).toBe(403);
    expect(runAiGatewayMock).not.toHaveBeenCalled();
  });

  it("rejects empty messages", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "   " }] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(runAiGatewayMock).not.toHaveBeenCalled();
  });
});
