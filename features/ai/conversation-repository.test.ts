import { describe, expect, it, vi } from "vitest";

import {
  cancelAiConversationTurnV2,
  claimAiConversationClarifyResponse,
  compareAndSwapAiConversationGatewayState,
  completeAiConversationTurn,
  createAiConversation,
  createAiConversationTurn,
  finishAiConversationTurnV2,
  finishAiConversationTurnV3,
  getAiConversationGatewayState,
  verifyAiConversationTerminalState,
  listAiConversationMessages,
  listAiConversationTurns,
  listAiConversations,
  recordAiConversationTurnStage,
  renewAiConversationTurnLease,
  renewAiConversationTurnLeaseV2,
  syncAiConversationSummary,
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

const v2Ids = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  ownerUserId: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  turnId: "00000000-0000-4000-8000-000000000004",
  invocationId: "00000000-0000-4000-8000-000000000005",
};
const gatewayRuntimeSnapshot = {
  version: 1,
  summaryVersion: 0,
  messageIds: [],
  groundingRefs: [],
  assembledAt: "2026-07-11T03:00:00.000Z",
  runtimeSelection: {
    runtime: "gateway" as const,
    protocol: "xingyao-hermes-gateway-v2",
    profile: "hermes-xingyao-v2",
  },
};

describe("Xingyao conversation repository", () => {
  it("records a turn stage with exact actor and conversation RPC bindings", async () => {
    const observedAt = "2026-08-03T16:00:00.000Z";
    const rpc = vi.fn().mockResolvedValue({
      data: {
        turnId: v2Ids.turnId,
        stage: "session_ready",
        observedAt,
        sessionAction: "rebuilt",
        content: "must-not-escape",
      },
      error: null,
    });

    const result = await recordAiConversationTurnStage(
      { rpc } as unknown as ConversationRepositoryClient,
      {
        organizationId: v2Ids.organizationId,
        ownerUserId: v2Ids.ownerUserId,
        conversationId: v2Ids.conversationId,
        turnId: v2Ids.turnId,
        stage: "session_ready",
        observedAt,
        sessionAction: "rebuilt",
      },
    );

    expect(rpc).toHaveBeenCalledWith("record_ai_chat_turn_stage", {
      p_organization_id: v2Ids.organizationId,
      p_owner_user_id: v2Ids.ownerUserId,
      p_conversation_id: v2Ids.conversationId,
      p_turn_id: v2Ids.turnId,
      p_stage: "session_ready",
      p_observed_at: observedAt,
      p_session_action: "rebuilt",
    });
    expect(result).toEqual({
      turnId: v2Ids.turnId,
      stage: "session_ready",
      observedAt,
      sessionAction: "rebuilt",
    });
  });

  it("returns the first persisted timestamp when a stage is recorded repeatedly", async () => {
    const firstObservedAt = "2026-08-03T16:00:00.000Z";
    const rpc = vi.fn().mockResolvedValue({
      data: {
        turnId: v2Ids.turnId,
        stage: "first_delta",
        observedAt: firstObservedAt,
      },
      error: null,
    });
    const client = { rpc } as unknown as ConversationRepositoryClient;
    const base = {
      organizationId: v2Ids.organizationId,
      ownerUserId: v2Ids.ownerUserId,
      conversationId: v2Ids.conversationId,
      turnId: v2Ids.turnId,
      stage: "first_delta" as const,
    };

    const first = await recordAiConversationTurnStage(client, {
      ...base,
      observedAt: firstObservedAt,
    });
    const replay = await recordAiConversationTurnStage(client, {
      ...base,
      observedAt: "2026-08-03T16:00:01.000Z",
    });

    expect(first).toEqual(replay);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("sanitizes turn-stage RPC errors and malformed responses", async () => {
    for (const response of [
      { data: null, error: { message: "secret Supabase body" } },
      {
        data: {
          turnId: v2Ids.turnId,
          stage: "context_ready",
          observedAt: "not-a-timestamp",
        },
        error: null,
      },
    ]) {
      const error = await recordAiConversationTurnStage(
        {
          rpc: vi.fn().mockResolvedValue(response),
        } as unknown as ConversationRepositoryClient,
        {
          organizationId: v2Ids.organizationId,
          ownerUserId: v2Ids.ownerUserId,
          conversationId: v2Ids.conversationId,
          turnId: v2Ids.turnId,
          stage: "context_ready",
          observedAt: "2026-08-03T16:00:00.000Z",
        },
      ).then(
        () => null,
        (reason: unknown) => reason,
      );

      expect(error).toMatchObject({
        code: "conversation_turn_stage_persist_failed",
      });
      expect(String(error)).not.toContain("Supabase");
      expect(String(error)).not.toContain("not-a-timestamp");
    }

    const rejected = await recordAiConversationTurnStage(
      {
        rpc: vi.fn().mockRejectedValue(new Error("secret transport body")),
      } as unknown as ConversationRepositoryClient,
      {
        organizationId: v2Ids.organizationId,
        ownerUserId: v2Ids.ownerUserId,
        conversationId: v2Ids.conversationId,
        turnId: v2Ids.turnId,
        stage: "context_ready",
        observedAt: "2026-08-03T16:00:00.000Z",
      },
    ).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(rejected).toMatchObject({
      code: "conversation_turn_stage_persist_failed",
    });
    expect(String(rejected)).not.toContain("secret transport body");

    await expect(
      recordAiConversationTurnStage(
        {
          rpc: vi.fn().mockResolvedValue({
            data: {
              turnId: v2Ids.turnId,
              stage: "agent_ready",
              observedAt: "2026-08-03T16:00:00.000Z",
            },
            error: null,
          }),
        } as unknown as ConversationRepositoryClient,
        {
          organizationId: v2Ids.organizationId,
          ownerUserId: v2Ids.ownerUserId,
          conversationId: v2Ids.conversationId,
          turnId: v2Ids.turnId,
          stage: "context_ready",
          observedAt: "2026-08-03T16:00:00.000Z",
        },
      ),
    ).rejects.toMatchObject({
      code: "conversation_turn_stage_persist_failed",
    });
  });

  it("creates an owner-scoped conversation and maps the public DTO", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: conversationRow, error: null });
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
    const limit = vi
      .fn()
      .mockResolvedValue({ data: [conversationRow], error: null });
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

  it("persists selected runtime snapshot before returning a new accepted turn", async () => {
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
    const returns = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "turn-1" }], error: null });
    const select = vi.fn(() => ({ returns }));
    const eqStatus = vi.fn(() => ({ select }));
    const eqOwner = vi.fn(() => ({ eq: eqStatus }));
    const eqOrganization = vi.fn(() => ({ eq: eqOwner }));
    const eqId = vi.fn(() => ({ eq: eqOrganization }));
    const update = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ update }));

    const result = await createAiConversationTurn(
      { rpc, from } as unknown as ConversationRepositoryClient,
      {
        organizationId: "org-1",
        ownerUserId: "user-1",
        conversationId: "conversation-1",
        clientRequestId: "request-123",
        mode: "deep",
        kind: "user",
        content: "瑙ｈ椋庨櫓",
        contextSnapshot: gatewayRuntimeSnapshot,
      },
    );

    expect(update).toHaveBeenCalledWith({
      status: "accepted",
      context_snapshot: gatewayRuntimeSnapshot,
      snapshot_version: 1,
    });
    expect(eqStatus).toHaveBeenCalledWith("status", "accepted");
    expect(result).toMatchObject({ turnId: "turn-1", duplicate: false });
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
        outcome: "partial",
        cancel_requested_at: "2026-07-11T03:01:30.000Z",
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
    const messageLimit = vi
      .fn()
      .mockResolvedValue({ data: messageRows, error: null });
    const turnLimit = vi
      .fn()
      .mockResolvedValue({ data: turnRows, error: null });
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

    expect(messageOrder).toHaveBeenCalledWith("sequence_no", {
      ascending: false,
    });
    expect(turnOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(messages.map((message) => message.id)).toEqual([
      "message-201",
      "message-202",
    ]);
    expect(turns.map((turn) => turn.id)).toEqual(["turn-100", "turn-101"]);
    expect(turns[1]).toMatchObject({
      outcome: "partial",
      cancelRequestedAt: "2026-07-11T03:01:30.000Z",
    });
    expect(turns[0]).toMatchObject({ outcome: null, cancelRequestedAt: null });
  });

  it("guards every state transition with the expected current status", async () => {
    const returns = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "turn-1" }], error: null });
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
      expect.objectContaining({
        status: "generating",
        provider_name: "deepseek",
      }),
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

  it("finishes a Hermes turn through the v2 outcome contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      finishAiConversationTurnV2(
        { rpc } as unknown as ConversationRepositoryClient,
        {
          organizationId: v2Ids.organizationId,
          ownerUserId: v2Ids.ownerUserId,
          turnId: v2Ids.turnId,
          invocationId: v2Ids.invocationId,
          outcome: "blocked",
          content: "缺少结算权限。",
          providerName: "deepseek",
          errorCode: null,
          errorSummary: null,
          retryable: false,
          metadata: { permissionDenials: ["settlements.summary"] },
        },
      ),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("finish_ai_chat_turn_v2", {
      p_organization_id: v2Ids.organizationId,
      p_owner_user_id: v2Ids.ownerUserId,
      p_turn_id: v2Ids.turnId,
      p_outcome: "blocked",
      p_content: "缺少结算权限。",
      p_provider_name: "deepseek",
      p_ai_invocation_id: v2Ids.invocationId,
      p_error_code: null,
      p_error_summary: null,
      p_retryable: false,
      p_metadata: { permissionDenials: ["settlements.summary"] },
    });
  });

  it("finishes a Hermes turn and structured memory through one v3 RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        completed: true,
        memory_status: "ready",
        summary_version: 5,
      },
      error: null,
    });
    const memoryDelta = {
      goals: [],
      confirmedFacts: [
        {
          text: "The target is 25%",
          sourceMessageIds: ["00000000-0000-4000-8000-000000000006"],
        },
      ],
      decisions: [],
      unresolvedQuestions: [],
      throughSequence: 9,
    };

    await expect(
      finishAiConversationTurnV3(
        { rpc } as unknown as ConversationRepositoryClient,
        {
          organizationId: v2Ids.organizationId,
          ownerUserId: v2Ids.ownerUserId,
          turnId: v2Ids.turnId,
          invocationId: v2Ids.invocationId,
          outcome: "complete",
          content: "The target is 25%.",
          providerName: "deepseek",
          errorCode: null,
          errorSummary: null,
          retryable: false,
          metadata: { evidence: [] },
          expectedSummaryVersion: 4,
          memoryDelta,
        },
      ),
    ).resolves.toEqual({
      completed: true,
      memoryStatus: "ready",
      summaryVersion: 5,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("finish_ai_chat_turn_v3", {
      p_organization_id: v2Ids.organizationId,
      p_owner_user_id: v2Ids.ownerUserId,
      p_turn_id: v2Ids.turnId,
      p_outcome: "complete",
      p_content: "The target is 25%.",
      p_provider_name: "deepseek",
      p_ai_invocation_id: v2Ids.invocationId,
      p_error_code: null,
      p_error_summary: null,
      p_retryable: false,
      p_metadata: { evidence: [] },
      p_expected_summary_version: 4,
      p_memory_delta: memoryDelta,
    });
  });

  it("exposes actor-scoped cancel, v2 lease, and provider-state wrappers", async () => {
    const cancelRpc = vi.fn().mockResolvedValue({
      data: {
        turn_id: v2Ids.turnId,
        status: "cancelled",
        cancel_requested: true,
        already_terminal: false,
        child_sessions: ["child-session"],
        revoked_capability_ids: ["00000000-0000-4000-8000-000000000006"],
      },
      error: null,
    });
    await expect(
      cancelAiConversationTurnV2(
        { rpc: cancelRpc } as unknown as ConversationRepositoryClient,
        {
          organizationId: v2Ids.organizationId,
          ownerUserId: v2Ids.ownerUserId,
          conversationId: v2Ids.conversationId,
          turnId: v2Ids.turnId,
        },
      ),
    ).resolves.toMatchObject({
      outcome: "cancelled",
      cancelRequested: true,
      childSessions: ["child-session"],
      revokedCapabilityIds: ["00000000-0000-4000-8000-000000000006"],
    });
    expect(cancelRpc).toHaveBeenCalledWith("cancel_ai_chat_turn", {
      p_organization_id: v2Ids.organizationId,
      p_owner_user_id: v2Ids.ownerUserId,
      p_conversation_id: v2Ids.conversationId,
      p_turn_id: v2Ids.turnId,
    });

    const renewRpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await renewAiConversationTurnLeaseV2(
      { rpc: renewRpc } as unknown as ConversationRepositoryClient,
      {
        organizationId: v2Ids.organizationId,
        ownerUserId: v2Ids.ownerUserId,
        turnId: v2Ids.turnId,
      },
    );
    expect(renewRpc).toHaveBeenCalledWith("renew_ai_chat_turn_lease", {
      p_organization_id: v2Ids.organizationId,
      p_owner_user_id: v2Ids.ownerUserId,
      p_turn_id: v2Ids.turnId,
    });

    const stateRpc = vi.fn().mockResolvedValue({
      data: { generation: 2 },
      error: null,
    });
    await expect(
      compareAndSwapAiConversationGatewayState(
        { rpc: stateRpc } as unknown as ConversationRepositoryClient,
        {
          organizationId: v2Ids.organizationId,
          ownerUserId: v2Ids.ownerUserId,
          conversationId: v2Ids.conversationId,
          expectedGeneration: 1,
          nextState: { generation: 2, sessionId: "session-1" },
        },
      ),
    ).resolves.toBe(2);
    expect(stateRpc).toHaveBeenCalledWith(
      "update_ai_conversation_hermes_state",
      {
        p_organization_id: v2Ids.organizationId,
        p_owner_user_id: v2Ids.ownerUserId,
        p_conversation_id: v2Ids.conversationId,
        p_expected_generation: 1,
        p_next_hermes_state: { generation: 2, sessionId: "session-1" },
      },
    );
  });

  it("loads Gateway state and synchronizes official compression summary with tenant and version guards", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        provider_state: {
          hermesGateway: {
            generation: 3,
            sessionId: "session-1",
            checkpointId: "checkpoint-1",
            provider: "hermes",
            model: "hermes-official-gateway",
            lastUsedAt: "2026-08-03T16:00:00.000Z",
            organizationId: "must-not-escape",
            invocationCapability: "must-not-escape",
            childSessions: ["child-1", "child-1", ""],
            checkpoint: {
              childSessions: ["child-2", "child-1"],
            },
            pendingClarify: {
              turnId: v2Ids.turnId,
              clarifyId: "00000000-0000-4000-8000-000000000007",
              requestId: "00000000-0000-4000-8000-000000000007",
              question: "Which scope?",
              choices: ["project", "streamer"],
              allowFreeText: false,
              response: {
                clarifyId: "00000000-0000-4000-8000-000000000007",
                answerSha256:
                  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
            },
          },
        },
        summary: {
          schemaVersion: 1,
          goals: [],
          confirmedFacts: [
            {
              text: "The target is 25%",
              sourceMessageIds: ["00000000-0000-4000-8000-000000000006"],
            },
          ],
          decisions: [],
          unresolvedQuestions: [],
          lastCompactedSequence: 9,
        },
        summary_version: 2,
        memory_status: "degraded",
        memory_degraded_at: "2026-08-03T16:01:00.000Z",
      },
      error: null,
    });
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
      })),
    }));
    const fromForGet = vi.fn(() => ({ select }));

    await expect(
      getAiConversationGatewayState(
        { from: fromForGet } as unknown as ConversationRepositoryClient,
        {
          organizationId: "org-1",
          ownerUserId: "user-1",
          conversationId: "conversation-1",
        },
      ),
    ).resolves.toEqual({
      generation: 3,
      sessionId: "session-1",
      checkpointId: "checkpoint-1",
      provider: "hermes",
      model: "hermes-official-gateway",
      lastUsedAt: "2026-08-03T16:00:00.000Z",
      childSessions: ["child-1", "child-2"],
      summary: {
        schemaVersion: 1,
        goals: [],
        confirmedFacts: [
          {
            text: "The target is 25%",
            sourceMessageIds: ["00000000-0000-4000-8000-000000000006"],
          },
        ],
        decisions: [],
        unresolvedQuestions: [],
        lastCompactedSequence: 9,
      },
      summaryVersion: 2,
      memoryStatus: "degraded",
      memoryDegradedAt: "2026-08-03T16:01:00.000Z",
      pendingClarify: {
        turnId: v2Ids.turnId,
        clarifyId: "00000000-0000-4000-8000-000000000007",
        requestId: "00000000-0000-4000-8000-000000000007",
        question: "Which scope?",
        choices: ["project", "streamer"],
        allowFreeText: false,
        response: {
          clarifyId: "00000000-0000-4000-8000-000000000007",
          answerSha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    });
    const loaded = await getAiConversationGatewayState(
      { from: fromForGet } as unknown as ConversationRepositoryClient,
      {
        organizationId: "org-1",
        ownerUserId: "user-1",
        conversationId: "conversation-1",
      },
    );
    expect(loaded).not.toHaveProperty("organizationId");
    expect(loaded).not.toHaveProperty("invocationCapability");
    expect(select).toHaveBeenCalledWith(
      "provider_state, summary, summary_version, memory_status, memory_degraded_at",
    );

    const returns = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "conversation-1" }], error: null });
    const syncEqSummaryVersion = vi.fn(() => ({
      select: vi.fn(() => ({ returns })),
    }));
    const syncEqOwner = vi.fn(() => ({ eq: syncEqSummaryVersion }));
    const syncEqOrganization = vi.fn(() => ({ eq: syncEqOwner }));
    const syncEqId = vi.fn(() => ({ eq: syncEqOrganization }));
    const update = vi.fn(() => ({ eq: syncEqId }));
    const fromForUpdate = vi.fn(() => ({ update }));

    await expect(
      syncAiConversationSummary(
        { from: fromForUpdate } as unknown as ConversationRepositoryClient,
        {
          organizationId: "org-1",
          ownerUserId: "user-1",
          conversationId: "conversation-1",
          expectedSummaryVersion: 2,
          summary: { text: "compressed" },
        },
      ),
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({
      summary: { text: "compressed" },
      summary_version: 3,
    });
    expect(syncEqSummaryVersion).toHaveBeenCalledWith("summary_version", 2);
  });

  it.each([
    ["arbitrary object", {}],
    ["missing hash", { clarifyId: "00000000-0000-4000-8000-000000000007" }],
    [
      "mismatched clarify id",
      {
        clarifyId: "00000000-0000-4000-8000-000000000008",
        answerSha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
    [
      "malformed hash",
      {
        clarifyId: "00000000-0000-4000-8000-000000000007",
        answerSha256: "not-a-sha256",
      },
    ],
  ])(
    "omits $name pending clarification response state",
    async (_name, response) => {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          provider_state: {
            hermesGateway: {
              generation: 1,
              pendingClarify: {
                turnId: v2Ids.turnId,
                clarifyId: "00000000-0000-4000-8000-000000000007",
                requestId: "00000000-0000-4000-8000-000000000007",
                question: "Which scope?",
                choices: ["project"],
                allowFreeText: false,
                response,
              },
            },
          },
          summary: {},
          summary_version: 0,
        },
        error: null,
      });
      const from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
          })),
        })),
      }));

      const state = await getAiConversationGatewayState(
        { from } as unknown as ConversationRepositoryClient,
        {
          organizationId: "org-1",
          ownerUserId: "user-1",
          conversationId: "conversation-1",
        },
      );

      expect(state?.pendingClarify).not.toHaveProperty("response");
    },
  );

  it("claims clarify responses atomically through the actor-scoped RPC before Gateway control", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "claimed",
        generation: 9,
      },
      error: null,
    });

    await expect(
      claimAiConversationClarifyResponse(
        { rpc } as unknown as ConversationRepositoryClient,
        {
          organizationId: v2Ids.organizationId,
          ownerUserId: v2Ids.ownerUserId,
          conversationId: v2Ids.conversationId,
          turnId: v2Ids.turnId,
          clarifyId: "00000000-0000-4000-8000-000000000007",
          answerSha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ),
    ).resolves.toEqual({ status: "claimed", generation: 9 });

    expect(rpc).toHaveBeenCalledWith("claim_ai_conversation_clarify_response", {
      p_organization_id: v2Ids.organizationId,
      p_owner_user_id: v2Ids.ownerUserId,
      p_conversation_id: v2Ids.conversationId,
      p_turn_id: v2Ids.turnId,
      p_clarify_id: "00000000-0000-4000-8000-000000000007",
      p_answer_sha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("verifies terminal SSE against an actor-owned persisted turn state", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        status: "completed",
        outcome: "partial",
        assistant_message_id: "message-assistant-1",
      },
      error: null,
    });
    const eqOwner = vi.fn(() => ({ maybeSingle }));
    const eqOrg = vi.fn(() => ({ eq: eqOwner }));
    const eqId = vi.fn(() => ({ eq: eqOrg }));
    const select = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ select }));

    await expect(
      verifyAiConversationTerminalState(
        { from } as unknown as ConversationRepositoryClient,
        {
          organizationId: v2Ids.organizationId,
          ownerUserId: v2Ids.ownerUserId,
          turnId: v2Ids.turnId,
          event: {
            type: "response.completed",
            conversationId: v2Ids.conversationId,
            turnId: v2Ids.turnId,
            messageId: "message-assistant-1",
            content: "done",
            outcome: "partial",
            evidence: [],
            missing: [],
            observationTimes: {
              firstObservedAt: null,
              lastObservedAt: null,
            },
          },
        },
      ),
    ).resolves.toBe(true);

    expect(select).toHaveBeenCalledWith(
      "status, outcome, assistant_message_id",
    );
    expect(eqId).toHaveBeenCalledWith("id", v2Ids.turnId);
    expect(eqOrg).toHaveBeenCalledWith("organization_id", v2Ids.organizationId);
    expect(eqOwner).toHaveBeenCalledWith("owner_user_id", v2Ids.ownerUserId);
  });
});
