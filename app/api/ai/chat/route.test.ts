import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.fn();
const getAuthContextMock = vi.fn();
const createConfiguredAiProvidersMock = vi.fn();
const resolveAiProviderRoutingMock = vi.fn();
const runAiGatewayMock = vi.fn();
const recordAiInvocationMock = vi.fn();

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

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    vi.resetModules();
    createSupabaseServerClientMock.mockReset();
    getAuthContextMock.mockReset();
    createConfiguredAiProvidersMock.mockReset();
    resolveAiProviderRoutingMock.mockReset();
    runAiGatewayMock.mockReset();
    recordAiInvocationMock.mockReset();

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
    runAiGatewayMock.mockResolvedValue({
      status: "succeeded",
      providerName: "deepseek",
      text: "你好，我可以继续分析经营数据。",
      fallbackUsed: false,
      usage: { promptTokens: 12, completionTokens: 9, totalTokens: 21 },
      latencyMs: 123,
      costCents: 0.01,
    });
    recordAiInvocationMock.mockResolvedValue("invocation-1");
  });

  it("forwards sanitized chat history to the configured model", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [
            { role: "assistant", content: "上一轮回复" },
            { role: "user", content: "你好" },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: { role: "assistant", content: "你好，我可以继续分析经营数据。" },
      providerName: "deepseek",
      status: "succeeded",
    });
    expect(runAiGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryProvider: "deepseek",
        request: expect.objectContaining({
          kind: "text",
          promptKey: "dashboard.ai.chat",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            { role: "assistant", content: "上一轮回复" },
            { role: "user", content: "你好" },
          ]),
        }),
      }),
    );
    expect(recordAiInvocationMock).toHaveBeenCalledWith({
      client: expect.anything(),
      actor: expect.objectContaining({ userId: "user-1", role: "ops_manager" }),
      input: expect.objectContaining({
        scene: "dashboard_ai_chat",
        providerName: "deepseek",
        status: "succeeded",
        promptKey: "dashboard.ai.chat",
      }),
    });
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
