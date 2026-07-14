import { describe, expect, it, vi } from "vitest";

import {
  completeAiConversationTurn,
  createAiConversation,
  createAiConversationTurn,
  listAiConversationMessages,
  listAiConversationTurns,
  listAiConversations,
  renewAiConversationTurnLease,
  transitionAiConversationTurn,
  type ConversationRepositoryClient,
} from "./conversation-repository";

const conversationRow = {
  id: "conversation-1",
  title: "风险处置",
  status: "active",
  last_message_at: "2026-07-11T03:00:00.000Z",
  created_at: "2026-07-11T03:00:00.000Z",
  updated_at: "2026-07-11T03:00:00.000Z",
};

describe("Xingyao conversation repository", () => {
  it("creates an owner-scoped conversation and maps the public DTO", async () => {
    const single = vi.fn().mockResolvedValue({ data: conversationRow, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));

    const conversation = await createAiConversation(
      { from } as unknown as ConversationRepositoryClient,
      {
        organizationId: "org-1",
        ownerUserId: "user-1",
        title: "风险处置",
      },
    );

    expect(from).toHaveBeenCalledWith("ai_conversations");
    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      owner_user_id: "user-1",
      title: "风险处置",
    });
    expect(conversation).toEqual({
      id: "conversation-1",
      title: "风险处置",
      status: "active",
      lastMessageAt: "2026-07-11T03:00:00.000Z",
      createdAt: "2026-07-11T03:00:00.000Z",
      updatedAt: "2026-07-11T03:00:00.000Z",
    });
  });

  it("lists only active conversations for the organization owner", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [conversationRow], error: null });
    const order = vi.fn(() => ({ limit }));
    const eqStatus = vi.fn(() => ({ order }));
    const eqOwner = vi.fn(() => ({ eq: eqStatus }));
    const eqOrganization = vi.fn(() => ({ eq: eqOwner }));
    const select = vi.fn(() => ({ eq: eqOrganization }));
    const from = vi.fn(() => ({ select }));

    const conversations = await listAiConversations(
      { from } as unknown as ConversationRepositoryClient,
      { organizationId: "org-1", ownerUserId: "user-1", limit: 20 },
    );

    expect(eqOrganization).toHaveBeenCalledWith("organization_id", "org-1");
    expect(eqOwner).toHaveBeenCalledWith("owner_user_id", "user-1");
    expect(eqStatus).toHaveBeenCalledWith("status", "active");
    expect(order).toHaveBeenCalledWith("last_message_at", { ascending: false });
    expect(conversations).toHaveLength(1);
  });

  it("creates user, assistant and turn rows through one idempotent RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        conversation_id: "conversation-1",
        turn_id: "turn-1",
        user_message_id: "user-message-1",
        assistant_message_id: "assistant-message-1",
        status: "accepted",
        attempt_no: 1,
        duplicate: false,
      },
      error: null,
    });

    const result = await createAiConversationTurn(
      { rpc } as unknown as ConversationRepositoryClient,
      {
        organizationId: "org-1",
        ownerUserId: "user-1",
        conversationId: "conversation-1",
        clientRequestId: "request-123",
        mode: "deep",
        kind: "user",
        content: "解读风险",
      },
    );

    expect(rpc).toHaveBeenCalledWith("create_ai_chat_turn", {
      p_organization_id: "org-1",
      p_owner_user_id: "user-1",
      p_conversation_id: "conversation-1",
      p_idempotency_key: "request-123",
      p_mode: "deep",
      p_kind: "user",
      p_content: "解读风险",
      p_source_turn_id: null,
    });
    expect(result).toMatchObject({
      turnId: "turn-1",
      userMessageId: "user-message-1",
      assistantMessageId: "assistant-message-1",
      duplicate: false,
    });
  });

  it("preserves a lease-expired duplicate status from the public RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        conversation_id: "conversation-1",
        turn_id: "turn-expired",
        user_message_id: "user-message-1",
        assistant_message_id: "assistant-message-1",
        status: "failed",
        attempt_no: 1,
        duplicate: true,
      },
      error: null,
    });

    const result = await createAiConversationTurn(
      { rpc } as unknown as ConversationRepositoryClient,
      {
        organizationId: "org-1",
        ownerUserId: "user-1",
        conversationId: "conversation-1",
        clientRequestId: "request-expired",
        mode: "fast",
        kind: "user",
        content: "resume the expired turn",
      },
    );

    expect(result).toMatchObject({
      turnId: "turn-expired",
      status: "failed",
      attempt: 1,
      duplicate: true,
    });
  });

  it("loads the newest message and turn windows, then restores chronological order", async () => {
    const messageRows = [
      {
        id: "message-202",
        conversation_id: "conversation-1",
        sequence_no: 202,
        role: "assistant",
        status: "completed",
        content: "latest",
        parent_message_id: "message-201",
        metadata: {},
        created_at: "2026-07-11T03:02:00.000Z",
        updated_at: "2026-07-11T03:02:00.000Z",
      },
      {
        id: "message-201",
        conversation_id: "conversation-1",
        sequence_no: 201,
        role: "user",
        status: "completed",
        content: "latest question",
        parent_message_id: null,
        metadata: {},
        created_at: "2026-07-11T03:01:00.000Z",
        updated_at: "2026-07-11T03:01:00.000Z",
      },
    ];
    const turnRows = [
      {
        id: "turn-101",
        conversation_id: "conversation-1",
        user_message_id: "message-201",
        assistant_message_id: "message-202",
        mode: "fast",
        status: "completed",
        attempt_no: 1,
        context_snapshot: null,
        retry_of_turn_id: null,
        regenerate_of_turn_id: null,
        provider_name: "deepseek",
        error_code: null,
        error_summary: null,
        retryable: false,
      },
      {
        id: "turn-100",
        conversation_id: "conversation-1",
        user_message_id: "message-199",
        assistant_message_id: "message-200",
        mode: "fast",
        status: "completed",
        attempt_no: 1,
        context_snapshot: null,
        retry_of_turn_id: null,
        regenerate_of_turn_id: null,
        provider_name: "deepseek",
        error_code: null,
        error_summary: null,
        retryable: false,
      },
    ];
    const messageLimit = vi.fn().mockResolvedValue({ data: messageRows, error: null });
    const turnLimit = vi.fn().mockResolvedValue({ data: turnRows, error: null });
    const messageOrder = vi.fn(() => ({ limit: messageLimit }));
    const turnOrder = vi.fn(() => ({ limit: turnLimit }));
    const buildQuery = (order: ReturnType<typeof vi.fn>) => {
      const eqOwner = vi.fn(() => ({ order }));
      const eqOrganization = vi.fn(() => ({ eq: eqOwner }));
      const eqConversation = vi.fn(() => ({ eq: eqOrganization }));
      return { select: vi.fn(() => ({ eq: eqConversation })) };
    };
    const messageQuery = buildQuery(messageOrder);
    const turnQuery = buildQuery(turnOrder);
    const from = vi.fn((table: string) =>
      table === "ai_chat_messages" ? messageQuery : turnQuery,
    );
    const client = { from } as unknown as ConversationRepositoryClient;
    const scope = {
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      limit: 200,
    };

    const messages = await listAiConversationMessages(client, scope);
    const turns = await listAiConversationTurns(client, scope);

    expect(messageOrder).toHaveBeenCalledWith("sequence_no", { ascending: false });
    expect(turnOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(messages.map((message) => message.id)).toEqual(["message-201", "message-202"]);
    expect(turns.map((turn) => turn.id)).toEqual(["turn-100", "turn-101"]);
  });

  it("guards every state transition with the expected current status", async () => {
    const returns = vi.fn().mockResolvedValue({ data: [{ id: "turn-1" }], error: null });
    const select = vi.fn(() => ({ returns }));
    const eqStatus = vi.fn(() => ({ select }));
    const eqOwner = vi.fn(() => ({ eq: eqStatus }));
    const eqOrganization = vi.fn(() => ({ eq: eqOwner }));
    const eqId = vi.fn(() => ({ eq: eqOrganization }));
    const update = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ update }));

    const transitioned = await transitionAiConversationTurn(
      { from } as unknown as ConversationRepositoryClient,
      {
        organizationId: "org-1",
        ownerUserId: "user-1",
        turnId: "turn-1",
        from: "grounding",
        to: "generating",
        patch: { providerName: "deepseek" },
      },
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "generating", provider_name: "deepseek" }),
    );
    expect(eqStatus).toHaveBeenCalledWith("status", "grounding");
    expect(transitioned).toBe(true);
  });

  it("commits the assistant message and terminal turn state atomically", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    const completed = await completeAiConversationTurn(
      { rpc } as unknown as ConversationRepositoryClient,
      {
        organizationId: "org-1",
        ownerUserId: "user-1",
        turnId: "turn-1",
        content: "建议优先处理高风险事项。",
        providerName: "deepseek",
        invocationId: "invocation-1",
        metadata: { grounding: { suggestedActions: [] } },
      },
    );

    expect(rpc).toHaveBeenCalledWith("finish_ai_chat_turn", {
      p_organization_id: "org-1",
      p_owner_user_id: "user-1",
      p_turn_id: "turn-1",
      p_succeeded: true,
      p_content: "建议优先处理高风险事项。",
      p_provider_name: "deepseek",
      p_ai_invocation_id: "invocation-1",
      p_error_code: null,
      p_error_summary: null,
      p_retryable: false,
      p_metadata: { grounding: { suggestedActions: [] } },
    });
    expect(completed).toBe(true);
  });

  it("renews an active turn lease through the database clock", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      renewAiConversationTurnLease(
        { rpc } as unknown as ConversationRepositoryClient,
        {
          organizationId: "org-1",
          ownerUserId: "user-1",
          turnId: "turn-1",
        },
      ),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("renew_ai_chat_turn_lease", {
      p_organization_id: "org-1",
      p_owner_user_id: "user-1",
      p_turn_id: "turn-1",
    });
  });
});
