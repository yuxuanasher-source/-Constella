import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteContextMock = vi.fn();

vi.mock("@/app/api/ai/conversation-route-context", () => ({
  getAiConversationRouteContext: getRouteContextMock,
  conversationRouteErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    ),
}));

describe("/api/ai/conversations", () => {
  beforeEach(() => {
    vi.resetModules();
    getRouteContextMock.mockReset();
  });

  it("creates an owner-scoped conversation", async () => {
    const createConversation = vi.fn().mockResolvedValue({
      id: "conversation-1",
      title: "风险处置",
      status: "active",
    });
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId: "org-1", userId: "user-1" },
      service: { createConversation },
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "风险处置" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createConversation).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      "风险处置",
    );
    await expect(response.json()).resolves.toMatchObject({
      conversation: { id: "conversation-1" },
    });
  });

  it("lists only conversations exposed by the owner-scoped service", async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValue([{ id: "conversation-1", title: "风险处置" }]);
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId: "org-1", userId: "user-1" },
      service: { listConversations },
    });
    const { GET } = await import("./route");

    const response = await GET();

    expect(listConversations).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      30,
    );
    await expect(response.json()).resolves.toEqual({
      conversations: [{ id: "conversation-1", title: "风险处置" }],
    });
  });
});
