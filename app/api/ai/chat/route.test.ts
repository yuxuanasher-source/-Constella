import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.fn();
const getAuthContextMock = vi.fn();
const createConfiguredAiProvidersMock = vi.fn();
const resolveAiProviderRoutingMock = vi.fn();
const runAiGatewayMock = vi.fn();
const recordAiInvocationMock = vi.fn();
const loadRoleHomeDashboardMock = vi.fn();
const searchKnowledgeDocumentsMock = vi.fn();
const listLiveReviewDocumentsMock = vi.fn();
const createAiDraftMock = vi.fn();

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

vi.mock("@/features/ai/knowledge-repository", () => ({
  searchKnowledgeDocuments: searchKnowledgeDocumentsMock,
}));

vi.mock("@/features/live-review/live-review-service", () => ({
  listLiveReviewDocuments: listLiveReviewDocumentsMock,
}));

vi.mock("@/features/ai/draft-repository", () => ({
  createAiDraft: createAiDraftMock,
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
    searchKnowledgeDocumentsMock.mockReset();
    listLiveReviewDocumentsMock.mockReset();
    createAiDraftMock.mockReset();

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
    searchKnowledgeDocumentsMock.mockResolvedValue([
      {
        id: "kb-retro-1",
        docType: "retrospective",
        title: "低转化复盘打法",
        snippet:
          "历史复盘显示，开场福利节点不清晰会造成互动断层，应提前准备福利钩子。",
        sourceRef: "knowledge.retrospective:low-conversion",
        tags: ["复盘", "低转化"],
        score: 7,
      },
    ]);
    listLiveReviewDocumentsMock.mockResolvedValue([
      {
        id: "live-review-1",
        title: "低转化直播复盘",
        contentMd: [
          "## 一、基础信息",
          "| 本场目标 | 提升转化 |",
          "## 三、做对了什么",
          "- 内容：开场福利节点能提升停留",
          "## 四、问题与归因（这一段是复盘的核心）",
          "| 问题现象 | 直接原因 | 根因 | 性质 |",
          "| 互动下滑 | 福利节奏不清楚 | 开场福利节点缺少明确钩子 | 结构性 |",
          "## 五、行动项",
          "| 行动 | 负责人 | 截止 | 验证指标 |",
          "| 开播前确认福利钩子 | 运营 | 下场前 | 3 分钟互动率 |",
        ].join("\n"),
        createdAt: "2026-06-20T10:00:00.000Z",
      },
    ]);
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
    createAiDraftMock.mockResolvedValue({ id: "draft-retro-1" });
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
    expect(groundedText).toContain("知识库引用包");
    expect(groundedText).toContain("knowledge.retrospective:low-conversion");
    expect(groundedText).toContain("AI 复盘助手 · 基于组织知识库");
    expect(searchKnowledgeDocumentsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        query: "默认分析本月",
        limit: 5,
      }),
    );
    expect(listLiveReviewDocumentsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org-1", role: "ops_manager" }),
      expect.objectContaining({ limit: 100 }),
    );
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
          knowledgePassageCount: 1,
          reviewKnowledgeSampleSize: 1,
        }),
      }),
    });
    expect(createAiDraftMock).not.toHaveBeenCalled();
  });

  it("returns cited knowledge context and a pending retrospective draft for human confirmation", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "生成本月复盘并沉淀经验" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.knowledge).toMatchObject({
      passages: [
        expect.objectContaining({
          id: "kb-retro-1",
          sourceRef: "knowledge.retrospective:low-conversion",
        }),
      ],
      citations: [
        expect.objectContaining({
          docId: "kb-retro-1",
          sourceRef: "knowledge.retrospective:low-conversion",
        }),
      ],
      reviewAssist: expect.objectContaining({
        sampleSize: 1,
        assistMarkdown: expect.stringContaining("开场福利节点缺少明确钩子"),
      }),
    });
    expect(body.retrospectiveDraft).toMatchObject({
      draftType: "retrospective",
      status: "pending",
      targetStateMachine: "retrospective",
      targetState: "published",
      payload: {
        periodLabel: "本月经营复盘",
        metrics: expect.arrayContaining([
          expect.objectContaining({
            label: "本月厂家应收",
            value: "240",
            unit: "元",
            sourceRef: "dashboard.kpis.receivable",
          }),
        ]),
        references: [
          expect.objectContaining({
            docId: "kb-retro-1",
            sourceRef: "knowledge.retrospective:low-conversion",
          }),
        ],
      },
    });
    expect(body.retrospectiveDraft.note).toContain("需人工确认后发布");
    expect(body.retrospectiveDraftId).toBe("draft-retro-1");
    expect(createAiDraftMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        actingUserId: "user-1",
        envelope: expect.objectContaining({
          draftType: "retrospective",
          status: "pending",
        }),
      }),
    );
  });

  it("returns project health grounding for product workflows", async () => {
    loadRoleHomeDashboardMock.mockResolvedValueOnce({
      profile: {
        role: "ops_manager",
        title: "Operations overview",
        subtitle: "Operational loop",
        scopeLabel: "All org",
      },
      kpis: [
        { key: "activeProjects", label: "Active projects", value: 2 },
        { key: "pendingReports", label: "Pending reports", value: 7 },
      ],
      queue: [
        {
          key: "queue:p-low-margin",
          title: "Nova Launch",
          subtitle: "Pending reports are blocking settlement",
          tone: "amber",
          target: { route: "project", id: "p-low-margin" },
        },
      ],
      risks: [
        {
          key: "risk:p-low-margin",
          title: "Nova Launch",
          subtitle: "High-risk notice requires manual validation",
          tone: "red",
          target: { route: "project", id: "p-low-margin" },
        },
      ],
      drilldowns: [],
      panels: {
        projectRanking: {
          title: "Project contribution ranking",
          rows: [
            {
              key: "rank:p-low-margin",
              title: "Nova Launch",
              value: -19000,
              hint: "margin -12.5%",
              tone: "amber",
              target: { route: "project", id: "p-low-margin" },
            },
          ],
        },
      },
      generatedAt: "2026-06-28T01:20:00.000Z",
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "What should we fix first?" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.grounding.projectHealth.topProjects[0]).toMatchObject({
      projectId: "p-low-margin",
      projectName: "Nova Launch",
      priority: "high",
    });
    expect(body.grounding.suggestedActions[0]).toMatchObject({
      actionId: "p-low-margin:margin-review",
      projectName: "Nova Launch",
      requiresHumanApproval: true,
    });
    expect(recordAiInvocationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          metadata: expect.objectContaining({
            groundingProjectHealthCount: 1,
            groundingSuggestedActionCount: 3,
          }),
        }),
      }),
    );
    const messages = runAiGatewayMock.mock.calls[0][0].request.messages;
    const groundedText = messages
      .map((message: { content: string }) => message.content)
      .join("\n");
    expect(groundedText).toContain("projectHealth");
    expect(groundedText).toContain("Nova Launch");
  });

  it("forwards deep mode reasoning options and sanitized attachments to the gateway", async () => {
    createConfiguredAiProvidersMock.mockReturnValueOnce([
      { name: "openai", capabilities: ["text"] },
      { name: "deepseek", capabilities: ["text"] },
    ]);
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          mode: "deep",
          messages: [{ role: "user", content: "Analyze the attached sheet" }],
          attachments: [
            {
              name: "finance.csv",
              mimeType: "text/csv",
              sizeBytes: 128,
              data: "data:text/csv;base64,cHJvamVjdCxyZXZlbnVlCg==",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runAiGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryProvider: "openai",
        request: expect.objectContaining({
          kind: "text",
          mode: "deep",
          reasoning: { effort: "high", summary: "auto" },
          attachments: [
            expect.objectContaining({
              name: "finance.csv",
              mimeType: "text/csv",
              data: "data:text/csv;base64,cHJvamVjdCxyZXZlbnVlCg==",
            }),
          ],
        }),
      }),
    );
    const messages = runAiGatewayMock.mock.calls[0][0].request.messages;
    const promptText = messages
      .map((message: { content: string }) => message.content)
      .join("\n");
    expect(promptText).toContain("Uploaded attachments");
    expect(promptText).toContain("finance.csv");
    expect(recordAiInvocationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          metadata: expect.objectContaining({
            chatMode: "deep",
            attachmentCount: 1,
          }),
        }),
      }),
    );
  });

  it("adds distinct answer profiles for fast and deep chat modes", async () => {
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          mode: "fast",
          messages: [{ role: "user", content: "Summarize current risks" }],
        }),
      }),
    );
    const fastMessages = runAiGatewayMock.mock.calls.at(-1)?.[0].request.messages;
    const fastPrompt = fastMessages
      .map((message: { content: string }) => message.content)
      .join("\n");

    await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          mode: "deep",
          messages: [{ role: "user", content: "Summarize current risks" }],
        }),
      }),
    );
    const deepMessages = runAiGatewayMock.mock.calls.at(-1)?.[0].request.messages;
    const deepPrompt = deepMessages
      .map((message: { content: string }) => message.content)
      .join("\n");

    expect(fastPrompt).toContain("mode profile: fast");
    expect(fastPrompt).toContain("answer in 3-5 concise bullets");
    expect(deepPrompt).toContain("mode profile: deep");
    expect(deepPrompt).toContain("evidence, uncertainty, risks, and next actions");
    expect(deepPrompt).not.toEqual(fastPrompt);
  });

  it("rejects chat requests with more than five attachments", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "Analyze these files" }],
          attachments: Array.from({ length: 6 }, (_, index) => ({
            name: `file-${index + 1}.txt`,
            mimeType: "text/plain",
            sizeBytes: 10,
            text: "hello",
          })),
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("five attachments"),
    });
    expect(runAiGatewayMock).not.toHaveBeenCalled();
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
